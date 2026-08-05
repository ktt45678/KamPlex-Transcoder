import child_process from 'child_process';
import path from 'path';

import { Progress } from '../common/entities';
import { FFProbeResult } from '../common/interfaces';

const URL_INPUT_ARGS: string[] = [
  '-reconnect', '1',
  '-reconnect_on_http_error', '400,401,403,408,409,429,5xx',
  '-tls_verify', '0'
];

export function spawnUnshelled(dir: string, binaryName: string, args: string[]) {
  const binary = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  return child_process.spawn(path.join(dir, binary), args);
}

export class FFmpegHelper {
  urlInputArgs() {
    return [...URL_INPUT_ARGS];
  }

  probeMedia(target: string, ffprobeDir: string, useURLInput?: boolean) {
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (useURLInput)
      args.push(...this.urlInputArgs());
    args.push(
      '-show_streams', '-show_format',
      '-print_format', 'json',
      '-i', target
    );

    return new Promise<FFProbeResult>((resolve, reject) => {
      const ffprobe = spawnUnshelled(ffprobeDir, 'ffprobe', args);

      let outputJson = '';
      let stderrOutput = '';
      ffprobe.stdout.setEncoding('utf8');
      ffprobe.stdout.on('data', (data: string) => {
        outputJson += data;
      });

      ffprobe.stderr.setEncoding('utf8');
      ffprobe.stderr.on('data', (data: string) => {
        stderrOutput += data;
      });

      ffprobe.on('error', (err) => reject(err));

      ffprobe.on('exit', (code: number) => {
        if (code !== 0) {
          reject(new Error(stderrOutput.trim() || `ffprobe exited with status code: ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(outputJson));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  parseProgress(data: string) {
    const tLines = data.split('\n');
    if (tLines.length < 5)
      console.log(data);
    const progress = new Progress();
    for (var i = 0; i < tLines.length; i++) {
      const key = tLines[i].split('=');
      switch (key[0]) {
        case 'frame':
          progress.frame = Number(key[1]);
          break;
        case 'fps':
          progress.fps = Number(key[1]);
          break;
        case 'bitrate':
          progress.bitrate = key[1];
          break;
        case 'total_size':
          progress.totalSize = Number(key[1]);
          break;
        case 'out_time_us':
          progress.outTimeUs = Number(key[1]);
          break;
        case 'out_time_ms':
          progress.outTimeMs = Number(key[1]);
          break;
        case 'out_time':
          progress.outTime = key[1];
          break;
        case 'dup_frames':
          progress.dupFrames = Number(key[1]);
          break;
        case 'drop_frames':
          progress.dropFrames = Number(key[1]);
          break;
        case 'speed':
          progress.speed = key[1].trim();
          break;
        case 'progress':
          progress.progress = key[1];
          break;
      }
    }
    return progress;
  }

  progressPercent(current: number, videoDuration: number) {
    return videoDuration ? Math.trunc(current / videoDuration * 100) : 0;
  }

  getProgressMessage(progress: Progress, percent: number) {
    return `Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime} - speed: ${progress.speed}`;
  }

  findH264ProfileLevel(srcWidth: number, srcHeight: number, targetHeight: number, fps: number) {
    const targetWidth = targetHeight * srcWidth / srcHeight;
    const targetFrameSize = targetWidth * targetHeight;
    // 4K 2160p
    if (targetFrameSize >= (3840 * 2160)) {
      if (targetFrameSize <= (4096 * 2160)) {
        if (fps <= 28)
          return '5.1';
        if (fps <= 60)
          return '5.2';
        return null;
      }
      if (targetFrameSize <= (4096 * 2304)) {
        if (fps <= 26)
          return '5.1';
        if (fps <= 56)
          return '5.2';
        return null;
      }
    }
    // 2K 1440p
    if (targetFrameSize >= (2560 * 1440)) {
      if (fps <= 30)
        return '5';
      if (fps <= 60)
        return '5.1';
      return null;
    }
    // FHD 1080p
    if (targetFrameSize >= (1920 * 1080)) {
      if (targetFrameSize <= (2048 * 1088)) {
        if (fps <= 30)
          return '4.1';
        if (fps <= 60)
          return '4.2';
        return null;
      }
      if (targetFrameSize <= (2560 * 1439)) {
        if (fps <= 30)
          return '5';
        if (fps <= 60)
          return '5.1';
        return null;
      }
    }
    // HD 720p
    if (targetFrameSize >= (1280 * 720)) {
      if (targetFrameSize === 1280 * 720) {
        if (fps <= 30)
          return '3.1';
        if (fps <= 60)
          return '3.2';
      }
      if (targetFrameSize <= (1280 * 1024)) {
        if (fps <= 30)
          return '3.2';
        if (fps <= 60)
          return '4.2';
        return null;
      }
      if (targetFrameSize <= (1920 * 1079)) {
        if (fps <= 30)
          return '5';
        if (fps <= 60)
          return '5.1';
        return null;
      }
    }
    // SD 480p
    if (targetFrameSize >= (854 * 480)) {
      if (targetFrameSize <= 720 * 576) {
        return '3.1';
      }
      if (targetFrameSize <= 1280 * 719) {
        return '3.2';
      }
    }
    return null;
  }
}

export interface SvtAv1Info {
  version: string;
  buildDate: string;
  notes: string[];
  asmLevel: string;
  widthHeightFps: string;
  bitDepthColor: string;
  colorPrimaries: string;
  presetTune: string;
  brcModeCrf: string;
  aqMode: string;
}

function getSvtLineValue(line: string): string {
  const content = line.replace(/^Svt\[info\]:\s*/, '');
  const idx = content.lastIndexOf(' : ');
  if (idx >= 0) return content.slice(idx + 3).trim();
  const ci = content.indexOf(':');
  return ci >= 0 ? content.slice(ci + 1).trim() : content;
}

function getSvtLineContent(line: string): string {
  return line.replace(/^Svt\[info\]:\s*/, '').replace(/\s+/g, ' ').trim();
}

export function parseSvtInfo(lines: string[]): SvtAv1Info {
  const find = (keyword: string) => {
    const line = lines.find(l => l.includes(keyword));
    return line ? getSvtLineValue(line) : '';
  };

  const sepIndices: number[] = [];
  lines.forEach((l, i) => { if (l.includes('---')) sepIndices.push(i); });
  const midStart = sepIndices[1] ?? -1;
  const midEnd = sepIndices[2] ?? lines.length;
  const notes = lines.slice(midStart + 1, midEnd)
    .filter(l => !l.includes('asm level'))
    .map(getSvtLineContent)
    .filter(Boolean);

  const asmLine = lines.find(l => l.includes('asm level selected'));
  return {
    version: find('[version]'),
    buildDate: find('LIB Build date'),
    notes,
    asmLevel: asmLine ? (asmLine.match(/up to ([^\]]+)/) || ['', ''])[1].trim() : '',
    widthHeightFps: find('width / height / fps'),
    bitDepthColor: find('bit-depth / color format'),
    colorPrimaries: find('color primaries / transfer'),
    presetTune: find('preset / tune'),
    brcModeCrf: find('BRC mode / rate factor'),
    aqMode: find('AQ mode'),
  };
}

export function formatSvtInfoSummary(info: SvtAv1Info): string | null {
  if (!info.version) return null;

  const vm = info.version.match(/^(SVT-AV1[^\s]*)\s+(?:Encoder\s+Lib\s+)?([0-9a-f]{6,})\s+"([^"]+)"/);
  const ver = vm ? `${vm[1]} ${vm[2]} "${vm[3]}"` : info.version;

  const headerParts = [ver, info.buildDate, ...info.notes].filter(Boolean);
  if (info.asmLevel) headerParts.push(`asm: ${info.asmLevel}`);

  const wh = info.widthHeightFps.split('/').map(s => s.trim());
  const res = wh.length >= 4 ? `${wh[0]}×${wh[1]} @${wh[2]}/${wh[3]}` : info.widthHeightFps;

  const bd = info.bitDepthColor.split('/').map(s => s.trim());
  const bitColor = bd.length >= 2 ? `${bd[0]}bit ${bd[1]}` : info.bitDepthColor;

  const cp = info.colorPrimaries.split('/').map(s => s.trim());
  const transfer = cp.length >= 3 ? cp[2] : info.colorPrimaries;

  const pt = info.presetTune.split('/').map(s => s.trim());
  const presetTune = pt.length >= 2 ? `${pt[0]}/${pt[1]}` : info.presetTune;

  const brc = info.brcModeCrf.split('/').map(s => s.trim());
  const brcStr = brc.length >= 3 ? `${brc[0]} ${brc[1]} max ${brc[2]}kbps` : info.brcModeCrf;

  const aq = info.aqMode.split('/').map(s => s.trim()).join('/');

  const line1 = `[SVT-AV1] ${headerParts.join(' | ')}`;
  const line2 = `[SVT-AV1] res: ${res} | fmt: ${bitColor} | xfer: ${transfer}`;
  const line3 = `[SVT-AV1] preset: ${presetTune} | rc: ${brcStr} | aq: ${aq}`;
  return `${line1}\n${line2}\n${line3}`;
}
export const ffmpegHelper = new FFmpegHelper();