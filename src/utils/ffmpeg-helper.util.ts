import { Progress } from '../common/entities';

export function parseProgress(data: string) {
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

export function progressPercent(current: number, videoDuration: number) {
  return videoDuration ? Math.trunc(current / videoDuration * 100) : 0;
}

export function findH264ProfileLevel(srcWidth: number, srcHeight: number, targetHeight: number, fps: number) {
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
  return null;
}