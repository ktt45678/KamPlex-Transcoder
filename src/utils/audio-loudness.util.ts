import child_process from 'child_process';

import { ffmpegHelper } from './ffmpeg-helper.util';
import { RejectCode } from '../enums';
import { LoudnessMeasurement } from './audio-downmix.util';

export interface MeasureDownmixOptions {
  inputFile: string;
  audioStreamIndex: number;
  matrix: string;
  ffmpegDir: string;
  stallTimeoutMs?: number;
  useURLInput?: boolean;
  onCancel?: (stop: () => void) => (() => void);
  logFn?: (message: string) => void;
}

const HEADER_PATTERN = /\[(ebur128@src|ebur128@dm)[^\]]*\]\s*Summary:/g;
const I_PATTERN = /I:\s*(-?[\d.]+)\s*LUFS/;
const PEAK_PATTERN = /Peak:\s*(-?[\d.]+)\s*dBFS/;

function parseSummaryBlocks(stderrOutput: string): { src?: string; dm?: string } {
  const blocks: { src?: string; dm?: string } = {};
  const matches = [...stderrOutput.matchAll(HEADER_PATTERN)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : stderrOutput.length;
    const body = stderrOutput.slice(start, end);
    if (match[1] === 'ebur128@src')
      blocks.src = body;
    else
      blocks.dm = body;
  }
  return blocks;
}

function parseField(block: string, pattern: RegExp): number | null {
  const match = pattern.exec(block);
  if (!match)
    return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export class AudioLoudnessHelper {
  measureDownmix(options: MeasureDownmixOptions): Promise<LoudnessMeasurement | null> {
    const { inputFile, audioStreamIndex, matrix, ffmpegDir, useURLInput, stallTimeoutMs, onCancel, logFn } = options;

    return new Promise<LoudnessMeasurement | null>((resolve, reject) => {
      let isCancelled = false;
      let stderrOutput = '';
      let hasActivity = false;
      let isStallTimeout = false;

      const args = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-loglevel', 'info'];
      if (useURLInput)
        args.push(...ffmpegHelper.urlInputArgs());
      args.push(
        '-i', `"${inputFile}"`,
        '-filter_complex',
        `"[0:${audioStreamIndex}]asplit=2[src][dm];` +
        `[src]ebur128@src=peak=true:framelog=quiet[sm];` +
        `[dm]${matrix},ebur128@dm=peak=true:framelog=quiet[dmm]"`,
        '-map', '"[sm]"', '-f', 'null', '-',
        '-map', '"[dmm]"', '-f', 'null', '-'
      );

      logFn?.('ffmpeg ' + args.join(' '));
      const ffmpeg = child_process.spawn(`"${ffmpegDir}/ffmpeg"`, args, { shell: true });

      ffmpeg.stderr.setEncoding('utf8');
      ffmpeg.stderr.on('data', (data: string) => { stderrOutput += data; });

      ffmpeg.stdout.on('data', () => { hasActivity = true; });

      const cancelCleanup = onCancel?.(() => {
        isCancelled = true;
        ffmpeg.kill('SIGINT');
      });

      const stallChecker = setInterval(() => {
        if (hasActivity) {
          hasActivity = false;
          return;
        }
        isStallTimeout = true;
        ffmpeg.kill('SIGINT');
        ffmpeg.kill('SIGTERM');
      }, stallTimeoutMs ?? 600_000);

      ffmpeg.on('error', (err) => {
        cancelCleanup?.();
        clearInterval(stallChecker);
        reject(err);
      });

      ffmpeg.on('exit', (code: number) => {
        cancelCleanup?.();
        clearInterval(stallChecker);
        if (isCancelled) {
          reject(RejectCode.JOB_CANCEL);
          return;
        }
        if (isStallTimeout) {
          reject(RejectCode.ENCODING_TIMEOUT);
          return;
        }
        if (code !== 0) {
          logFn?.(`ffmpeg exited with status code: ${code}, no downmix loudness measurement`);
          resolve(null);
          return;
        }
        resolve(this.parseMeasurement(stderrOutput, logFn));
      });
    });
  }

  private parseMeasurement(stderrOutput: string, logFn?: (message: string) => void): LoudnessMeasurement | null {
    const blocks = parseSummaryBlocks(stderrOutput);
    if (!blocks.src || !blocks.dm) {
      logFn?.('Missing ebur128 summary block, cannot measure downmix loudness');
      return null;
    }

    const sourceI = parseField(blocks.src, I_PATTERN);
    const downmixI = parseField(blocks.dm, I_PATTERN);
    const downmixTP = parseField(blocks.dm, PEAK_PATTERN);
    if (sourceI === null || downmixI === null || downmixTP === null) {
      logFn?.('Non-finite ebur128 value, cannot measure downmix loudness');
      return null;
    }

    return { sourceI, downmixI, downmixTP };
  }
}

export const audioLoudnessHelper = new AudioLoudnessHelper();
