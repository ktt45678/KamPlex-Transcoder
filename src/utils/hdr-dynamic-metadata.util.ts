import { stdout } from 'process';
import child_process from 'child_process';
import path from 'path';

import { fileHelper } from './file-helper.util';
import { HDRFormat, RejectCode } from '../enums';

const HDR10PLUS_TOOL = 'hdr10plus_tool';

const NO_METADATA_PATTERN = /doesn't contain dynamic metadata|does not contain dynamic metadata/i;

export interface HDRDynamicMetadataOptions {
  hdrToolsDir: string;
  ffmpegDir: string;
  useFFmpegPipe?: boolean;
  useURLInput?: boolean;
  onCancel?: (stop: () => void) => (() => void);
  logFn?: (message: string) => void;
}

export interface ExtractHDRDynamicMetadataOptions extends HDRDynamicMetadataOptions {
  inputFile: string;
  outputDir: string;
  outputBaseName: string;
  hdrFormat: number;
}

export interface ExtractedHDRDynamicMetadata {
  hdr10PlusJsonFile: string | null;
}

interface Hdr10PlusJson {
  SceneInfo?: Hdr10PlusSceneInfo[];
  SceneInfoSummary?: { SceneFirstFrameIndex: number[]; SceneFrameNumbers: number[]; };
  [key: string]: any;
}

interface Hdr10PlusSceneInfo {
  SceneId: number;
  SceneFrameIndex: number;
  SequenceFrameIndex: number;
  [key: string]: any;
}

export function toEncoderParamPath(filePath: string): string | null {
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.includes(':'))
    return null;
  return relativePath;
}

export function resolveHdr10PlusParamPath(segmentJsonFile: string | null | undefined,
  sourceJsonFile: string | null | undefined, logFn?: (message: string) => void): string | null {
  const jsonFile = segmentJsonFile !== undefined ? segmentJsonFile : sourceJsonFile;
  if (!jsonFile)
    return null;
  const paramPath = toEncoderParamPath(jsonFile);
  if (!paramPath)
    logFn?.(`HDR10+ metadata path cannot be passed to the encoder, it must not contain ':': ${jsonFile}`);
  return paramPath;
}

export interface FrameRate {
  num: number;
  den: number;
}

export function parseFrameRate(value?: string | number | null): FrameRate | null {
  if (value === null || value === undefined || value === '')
    return null;
  if (typeof value === 'string' && value.includes('/')) {
    const [num, den] = value.split('/').map(Number);
    if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0)
      return null;
    return { num, den };
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0)
    return null;
  return { num: rate, den: 1 };
}

export interface FrameIndex {
  frameAt(timeSeconds: number): number;
  timeAt(frameNumber: number): number | null;
  source: 'timestamps' | 'frame-rate';
  frameCount: number | null;
}

const TIMESTAMP_EPSILON = 5e-4;

export function frameIndexFromTimestamps(timestamps: number[]): FrameIndex {
  return {
    source: 'timestamps',
    frameCount: timestamps.length,
    frameAt(timeSeconds: number) {
      const target = timeSeconds - TIMESTAMP_EPSILON;
      let low = 0, high = timestamps.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (timestamps[mid] < target) low = mid + 1;
        else high = mid;
      }
      return low;
    },
    timeAt(frameNumber: number) {
      return frameNumber >= 0 && frameNumber < timestamps.length ? timestamps[frameNumber] : null;
    }
  };
}

export function frameIndexFromFrameRate(frameRate: FrameRate): FrameIndex {
  return {
    source: 'frame-rate',
    frameCount: null,
    frameAt(timeSeconds: number) {
      const quotient = (timeSeconds * frameRate.num) / frameRate.den;
      const nearest = Math.round(quotient);
      return Math.abs(quotient - nearest) < 1e-6 ? nearest : Math.ceil(quotient);
    },
    timeAt(frameNumber: number) {
      return frameNumber >= 0 ? (frameNumber * frameRate.den) / frameRate.num : null;
    }
  };
}

export interface FrameIndexOptions {
  inputFile: string;
  ffmpegDir: string;
  exactFps?: string | number | null;
  useURLInput?: boolean;
  logFn?: (message: string) => void;
}

export interface SegmentBoundary {
  index: number;
  startTime: number;
  startFrame: number | null;
  frameCount: number | null;
}

export function planSegments(totalDuration: number, segmentDuration: number,
  frameIndex?: FrameIndex | null): SegmentBoundary[] {
  if (!frameIndex) {
    const segmentCount = Math.ceil(totalDuration / segmentDuration);
    return Array.from({ length: segmentCount }, (unused, index) => ({
      index, startTime: index * segmentDuration, startFrame: null, frameCount: null
    }));
  }

  const totalFrames = frameIndex.frameCount ?? frameIndex.frameAt(totalDuration);
  const segments: SegmentBoundary[] = [];
  for (let gridIndex = 0; ; gridIndex++) {
    const startFrame = frameIndex.frameAt(gridIndex * segmentDuration);
    if (startFrame >= totalFrames)
      break;
    const endFrame = Math.min(frameIndex.frameAt((gridIndex + 1) * segmentDuration), totalFrames);
    if (endFrame === startFrame)
      continue;
    segments.push({
      index: segments.length,
      startTime: frameIndex.timeAt(startFrame) ?? gridIndex * segmentDuration,
      startFrame,
      frameCount: endFrame - startFrame
    });
  }
  return segments;
}

export interface SegmentHdr10PlusJsonOptions {
  jsonFile?: string | null;
  outputFile: string;
  startFrame?: number | null;
  frameCount?: number | null;
  logFn?: (message: string) => void;
}

function spawnUnshelled(dir: string, binaryName: string, args: string[]) {
  const binary = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  return child_process.spawn(path.join(dir, binary), args);
}

export class HDRDynamicMetadataHelper {
  extractHdr10PlusJson(inputFile: string, outputFile: string, options: HDRDynamicMetadataOptions) {
    return this.runTool(HDR10PLUS_TOOL, ['--skip-validation', 'extract'], '-o', inputFile, outputFile, options);
  }

  async extract(options: ExtractHDRDynamicMetadataOptions): Promise<ExtractedHDRDynamicMetadata> {
    const { inputFile, outputDir, outputBaseName, hdrFormat } = options;
    const result: ExtractedHDRDynamicMetadata = { hdr10PlusJsonFile: null };

    if (hdrFormat & HDRFormat.HDR10_PLUS) {
      const jsonFile = `${outputDir}/${outputBaseName}_hdr10plus.json`;
      if (await this.extractHdr10PlusJson(inputFile, jsonFile, options))
        result.hdr10PlusJsonFile = jsonFile;
    }
    return result;
  }

  async cleanup(metadata: ExtractedHDRDynamicMetadata) {
    if (metadata.hdr10PlusJsonFile)
      await fileHelper.deleteFile(metadata.hdr10PlusJsonFile);
  }

  async sliceHdr10PlusJson(jsonFile: string, outputFile: string, startFrame: number, frameCount: number) {
    const source = <Hdr10PlusJson>JSON.parse(<string>await fileHelper.readAllText(jsonFile, 'utf8'));
    const sceneInfo = source.SceneInfo?.slice(startFrame, startFrame + frameCount);
    if (!sceneInfo?.length)
      return null;

    let sceneId = -1;
    let previousSceneId: number | null = null;
    let sceneFrameIndex = 0;
    const sceneFirstFrameIndex: number[] = [];
    const sceneFrameNumbers: number[] = [];
    const slicedSceneInfo = sceneInfo.map((frame, index) => {
      if (frame.SceneId !== previousSceneId) {
        previousSceneId = frame.SceneId;
        sceneId++;
        sceneFrameIndex = 0;
        sceneFirstFrameIndex.push(index);
        sceneFrameNumbers.push(0);
      }
      sceneFrameNumbers[sceneId]++;
      return { ...frame, SceneId: sceneId, SceneFrameIndex: sceneFrameIndex++, SequenceFrameIndex: index };
    });

    const sliced: Hdr10PlusJson = {
      ...source,
      SceneInfo: slicedSceneInfo,
      SceneInfoSummary: { SceneFirstFrameIndex: sceneFirstFrameIndex, SceneFrameNumbers: sceneFrameNumbers }
    };
    await fileHelper.writeAllText(outputFile, JSON.stringify(sliced));
    return outputFile;
  }

  async createFrameIndex(options: FrameIndexOptions): Promise<FrameIndex | null> {
    const { inputFile, ffmpegDir, exactFps, useURLInput, logFn } = options;
    try {
      const timestamps = await this.readFrameTimestamps(inputFile, ffmpegDir, useURLInput, logFn);
      if (timestamps && timestamps.length > 1) {
        logFn?.(`Read ${timestamps.length} frame timestamps from ${inputFile}`);
        return frameIndexFromTimestamps(timestamps);
      }
    } catch (e) {
      const message = (<{ message?: string }>e)?.message || e.toString();
      logFn?.(`Could not read frame timestamps: ${message}`);
    }
    const parsedFrameRate = parseFrameRate(exactFps);
    if (!parsedFrameRate) {
      logFn?.(`No frame timestamps and no usable frame rate (got '${exactFps}')`);
      return null;
    }
    logFn?.(`Falling back to the nominal frame rate ${exactFps}, which assumes a constant rate`);
    return frameIndexFromFrameRate(parsedFrameRate);
  }

  private readFrameTimestamps(inputFile: string, ffmpegDir: string, useURLInput?: boolean,
    logFn?: (message: string) => void) {
    return new Promise<number[] | null>((resolve, reject) => {
      const args = ['-hide_banner', '-loglevel', 'error'];
      if (useURLInput) {
        args.push(
          '-reconnect', '1',
          '-reconnect_on_http_error', '400,401,403,408,409,429,5xx',
        );
      }
      args.push(
        '-select_streams', 'v:0',
        '-show_entries', 'packet=pts_time',
        '-of', 'csv=p=0',
        inputFile
      );
      logFn?.('ffprobe ' + args.join(' '));

      const ffprobe = spawnUnshelled(ffmpegDir, 'ffprobe', args);
      const timestamps: number[] = [];
      let pending = '';
      let stderrOutput = '';

      const consume = (line: string) => {
        const value = Number(line.split(',')[0]);
        if (Number.isFinite(value))
          timestamps.push(value);
      };

      ffprobe.stdout.setEncoding('utf8');
      ffprobe.stdout.on('data', (data: string) => {
        pending += data;
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) consume(line);
      });

      ffprobe.stderr.setEncoding('utf8');
      ffprobe.stderr.on('data', (data: string) => { stderrOutput += data; });

      ffprobe.on('error', reject);
      ffprobe.on('exit', (code: number) => {
        if (pending) consume(pending);
        if (code !== 0) {
          reject({ code, message: `ffprobe exited with status code: ${code}. ${stderrOutput}`.trim() });
          return;
        }
        timestamps.sort((a, b) => a - b);
        resolve(timestamps);
      });
    });
  }

  async createSegmentJson(options: SegmentHdr10PlusJsonOptions) {
    const { jsonFile, outputFile, startFrame, frameCount, logFn } = options;
    if (!jsonFile)
      return null;
    if (startFrame == null || frameCount == null) {
      logFn?.('No frame mapping for this source, encoding without HDR10+ metadata');
      return null;
    }
    try {
      const slicedFile = await this.sliceHdr10PlusJson(jsonFile, outputFile, startFrame, frameCount);
      if (!slicedFile)
        logFn?.(`No HDR10+ metadata for frames ${startFrame}-${startFrame + frameCount}, ` +
          'encoding this segment without it');
      return slicedFile;
    } catch (e) {
      const message = (<{ message?: string }>e)?.message || e.toString();
      logFn?.(`Failed to slice HDR10+ metadata for frames ${startFrame}-${startFrame + frameCount}: ${message}`);
      return null;
    }
  }

  private runTool(toolName: string, toolArgs: string[], outputFlag: string, inputFile: string, outputFile: string,
    options: HDRDynamicMetadataOptions) {
    return new Promise<boolean>((resolve, reject) => {
      let isCancelled = false;
      let stderrOutput = '';

      const args = [
        ...toolArgs,
        '-i', options.useFFmpegPipe ? '-' : inputFile,
        outputFlag, outputFile
      ];

      options.logFn?.(`${toolName} ${args.join(' ')}`);
      const tool = spawnUnshelled(options.hdrToolsDir, toolName, args);
      const ffmpeg = options.useFFmpegPipe ? this.spawnBitstreamPipe(inputFile, options) : null;

      if (ffmpeg) {
        tool.stdin.on('error', () => { });
        ffmpeg.stdout.pipe(tool.stdin);
        ffmpeg.stderr.setEncoding('utf8');
        ffmpeg.stderr.on('data', (data: string) => { stdout.write(data); });
      }

      tool.stdout.setEncoding('utf8');
      tool.stdout.on('data', (data: string) => { stdout.write(data); });

      tool.stderr.setEncoding('utf8');
      tool.stderr.on('data', (data: string) => {
        stderrOutput += data;
        stdout.write(data);
      });

      const cancelCleanup = options.onCancel?.(() => {
        isCancelled = true;
        ffmpeg?.kill('SIGINT');
        tool.kill('SIGINT');
        tool.kill('SIGTERM');
      });

      tool.on('error', (err) => {
        cancelCleanup?.();
        ffmpeg?.kill('SIGINT');
        reject(err);
      });

      tool.on('exit', async (code: number) => {
        stdout.write('\n');
        cancelCleanup?.();
        ffmpeg?.kill('SIGINT');
        if (isCancelled) {
          await fileHelper.deleteFile(outputFile);
          reject(RejectCode.JOB_CANCEL);
          return;
        }
        if (code === 0) {
          resolve(true);
          return;
        }
        if (NO_METADATA_PATTERN.test(stderrOutput)) {
          options.logFn?.(`${toolName} found no metadata in ${inputFile}, skipping`);
          await fileHelper.deleteFile(outputFile);
          resolve(false);
          return;
        }
        await fileHelper.deleteFile(outputFile);
        reject({ code, message: `${toolName} exited with status code: ${code}` });
      });
    });
  }

  private spawnBitstreamPipe(inputFile: string, options: HDRDynamicMetadataOptions) {
    const args = [
      '-hide_banner', '-loglevel', 'error'
    ];
    if (options.useURLInput) {
      args.push(
        '-reconnect', '1',
        '-reconnect_on_http_error', '400,401,403,408,409,429,5xx',
      );
    }
    args.push(
      '-i', inputFile,
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-f', 'hevc', '-'
    );
    options.logFn?.('ffmpeg ' + args.join(' '));
    return spawnUnshelled(options.ffmpegDir, 'ffmpeg', args);
  }
}

export const hdrDynamicMetadataHelper = new HDRDynamicMetadataHelper();
