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