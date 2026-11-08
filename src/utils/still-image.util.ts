import { Logger } from 'winston';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

import { ffmpegHelper, spawnUnshelled } from './ffmpeg-helper.util';
import { hdrTonemapFilters, HDRTonemapSource } from './hdr-tonemap.util';
import { HDRTransfer } from './mediainfo.util';

export const STILL_IMAGE_PROGRESS_COUNT = 10;
export const STILL_IMAGE_MAIN_HEIGHT = 720;
export const STILL_IMAGE_PROGRESS_WIDTH = 480;

const EDGE = 0.05;
const MAIN_RANGE_END = 0.4;
const SHORTLIST_PER_PART = 3;
const WEAK_SCORE = 0.3;
const FACE_SIZE = 640;
const FACE_MIN_SCORE = 0.75;
const FACE_NMS_IOU = 0.3;
const FACE_BONUS = 0.15;
const AVIF_QUALITY = 58;
const AVIF_EFFORT = 6;

export interface ScoredFrame {
  time: number;
  score: number;
}

export interface StillImagePicks {
  main: number;
  progress: number[];
}

export interface ExtractStillImageOptions {
  source: string;
  time: number;
  /** Fixed width, or fixed height when width is not set. */
  width?: number;
  height?: number;
  isHDR: boolean;
  hdrSource?: HDRTonemapSource;
  ffmpegDir: string;
  useURLInput: boolean;
}

interface FrameStats {
  time: number;
  mean: number;
  stdev: number;
  entropy: number;
  sharpness: number;
  colorful: number;
  change: number;
  grey: Buffer;
}

interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

type OrtModule = typeof import('onnxruntime-web');
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>;

export class FaceDetector {
  private constructor(private readonly ort: OrtModule, private readonly session: OrtSession) { }

  static async create(modelFile: string, logger?: Logger): Promise<FaceDetector | null> {
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(fs.readFileSync(modelFile), { executionProviders: ['wasm'] });
      return new FaceDetector(ort, session);
    } catch (e) {
      // Returns null when the runtime or the model is missing, the pick then runs on the frame score alone
      logger?.warning(`Face detection is not available: ${e.message}`);
      return null;
    }
  }

  async detect(file: string): Promise<Face[]> {
    const meta = await sharp(file).metadata();
    const scale = FACE_SIZE / Math.max(meta.width, meta.height);
    const width = Math.round(meta.width * scale);
    const height = Math.round(meta.height * scale);
    const raw = await sharp(file).resize(width, height).extend({ right: FACE_SIZE - width, bottom: FACE_SIZE - height, background: '#000' })
      .removeAlpha().raw().toBuffer();
    // BGR, planar, 0 to 255 for YuNet model
    const plane = FACE_SIZE * FACE_SIZE;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      input[i] = raw[i * 3 + 2];
      input[plane + i] = raw[i * 3 + 1];
      input[2 * plane + i] = raw[i * 3];
    }
    const output = await this.session.run({ input: new this.ort.Tensor('float32', input, [1, 3, FACE_SIZE, FACE_SIZE]) });
    return decodeFaces(output).map(f => ({ ...f, x: f.x / scale, y: f.y / scale, w: f.w / scale, h: f.h / scale }));
  }
}

function decodeFaces(output: Record<string, { data: unknown }>): Face[] {
  const faces: Face[] = [];
  for (const stride of [8, 16, 32]) {
    const cells = FACE_SIZE / stride;
    const cls = output[`cls_${stride}`].data as Float32Array;
    const obj = output[`obj_${stride}`].data as Float32Array;
    const box = output[`bbox_${stride}`].data as Float32Array;
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const i = row * cells + col;
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (score < FACE_MIN_SCORE)
          continue;
        const w = Math.exp(box[i * 4 + 2]) * stride;
        const h = Math.exp(box[i * 4 + 3]) * stride;
        faces.push({ x: (col + box[i * 4]) * stride - w / 2, y: (row + box[i * 4 + 1]) * stride - h / 2, w, h, score });
      }
    }
  }
  faces.sort((a, b) => b.score - a.score);
  return faces.filter((f, i) => faces.slice(0, i).every(g => overlap(f, g) < FACE_NMS_IOU));
}

function overlap(a: Face, b: Face) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / (a.w * a.h + b.w * b.h - x * y);
}

function faceBonus(faces: Face[], width: number, height: number) {
  // A face of a reasonable size that is not cut by the frame edge
  const usable = faces.some(f => {
    const share = (f.w * f.h) / (width * height);
    const inside = f.x >= 0 && f.y >= 0 && f.x + f.w <= width && f.y + f.h <= height;
    return inside && share >= 0.03 && share <= 0.3;
  });
  return usable ? FACE_BONUS : 0;
}

async function readFrameStats(file: string, time: number): Promise<FrameStats> {
  const [stats, small] = await Promise.all([
    sharp(file).stats(),
    sharp(file).resize(64).greyscale().raw().toBuffer({ resolveWithObject: true })
  ]);
  const grey = small.data;
  let sum = 0;
  for (const value of grey)
    sum += value;
  const mean = sum / grey.length;
  let variance = 0;
  for (const value of grey)
    variance += (value - mean) ** 2;
  const [r, g, b] = stats.channels;
  return {
    time,
    mean: mean / 255,
    stdev: Math.sqrt(variance / grey.length) / 255,
    entropy: stats.entropy,
    sharpness: stats.sharpness,
    colorful: Math.hypot(r.mean - g.mean, g.mean - b.mean, r.mean - b.mean) / 255,
    change: 0,
    grey
  };
}

function scoreFrames(frames: FrameStats[]): ScoredFrame[] {
  for (let i = 1; i < frames.length; i++) {
    let diff = 0;
    for (let p = 0; p < frames[i].grey.length; p++)
      diff += Math.abs(frames[i].grey[p] - frames[i - 1].grey[p]);
    frames[i].change = diff / frames[i].grey.length / 255;
  }
  const sharpMax = Math.max(...frames.map(f => f.sharpness)) || 1;
  return frames.map((f, i) => {
    const steady = Math.max(0, 1 - 6 * Math.max(f.change, frames[i + 1]?.change ?? 0));
    const exposure = Math.max(0, 1 - Math.abs(f.mean - 0.45) / 0.4);
    const contrast = Math.min(1, f.stdev / 0.22);
    const detail = Math.min(1, f.entropy / 7.5);
    const usable = f.mean > 0.08 && f.mean < 0.9 && f.stdev > 0.05;
    const base = 0.35 * (f.sharpness / sharpMax) + 0.2 * exposure + 0.2 * contrast + 0.15 * detail + 0.1 * Math.min(1, f.colorful * 4);
    return { time: f.time, score: usable ? base * (0.4 + 0.6 * steady) : 0 };
  });
}

function bestOf(frames: ScoredFrame[]) {
  return frames.reduce((best, f) => f.score > best.score ? f : best, frames[0]);
}

export async function pickStillImageTimes(framesDir: string, frameCount: number, duration: number, faceDetector: FaceDetector | null): Promise<StillImagePicks | null> {
  // framesDir holds the 1 fps frames named thumb_<n>.png where frame n is at second n - 1
  const from = Math.floor(duration * EDGE);
  const to = Math.min(frameCount - 1, Math.floor(duration * (1 - EDGE)));
  if (to - from + 1 < STILL_IMAGE_PROGRESS_COUNT)
    return null;
  const frames: FrameStats[] = [];
  const batch = 8;
  for (let start = from; start <= to; start += batch) {
    const times = Array.from({ length: Math.min(batch, to - start + 1) }, (_, i) => start + i);
    frames.push(...await Promise.all(times.map(t => readFrameStats(path.join(framesDir, `thumb_${t + 1}.png`), t))));
  }
  const scored = scoreFrames(frames);

  const partLength = (to - from + 1) / STILL_IMAGE_PROGRESS_COUNT;
  const parts = Array.from({ length: STILL_IMAGE_PROGRESS_COUNT }, (_, i) =>
    scored.filter(f => f.time >= from + i * partLength && f.time < from + (i + 1) * partLength));
  const mainEnd = duration * MAIN_RANGE_END;
  const mainPart = scored.filter(f => f.time <= mainEnd);

  const shortlist = (part: ScoredFrame[]) => [...part].sort((a, b) => b.score - a.score).slice(0, SHORTLIST_PER_PART);
  const faceScores = new Map<number, number>();
  if (faceDetector) {
    const candidates = new Set([...parts.flatMap(shortlist), ...shortlist(mainPart)].map(f => f.time));
    for (const time of candidates) {
      const file = path.join(framesDir, `thumb_${time + 1}.png`);
      const meta = await sharp(file).metadata();
      faceScores.set(time, faceBonus(await faceDetector.detect(file), meta.width, meta.height));
    }
  }
  const finalScore = (f: ScoredFrame) => f.score + (faceScores.get(f.time) ?? 0);
  const pickFrom = (part: ScoredFrame[]) => {
    const candidates = faceDetector ? shortlist(part) : part;
    return candidates.reduce((best, f) => finalScore(f) > finalScore(best) ? f : best, candidates[0]);
  };

  const progress: number[] = [];
  const unused = (part: ScoredFrame[]) => part.filter(f => !progress.includes(f.time));
  for (let i = 0; i < parts.length; i++) {
    const own = unused(parts[i]);
    if (!own.length)
      continue;
    let pick = pickFrom(own);
    // A weak tenth takes the best frame of the next one, or the one before for the last
    const neighbour = unused(parts[i + 1]?.length ? parts[i + 1] : parts[i - 1] ?? []);
    if (finalScore(pick) < WEAK_SCORE && neighbour.length) {
      const other = pickFrom(neighbour);
      pick = finalScore(other) > finalScore(pick) ? other : pick;
    }
    progress.push(pick.time);
  }
  progress.sort((a, b) => a - b);
  if (!mainPart.length || progress.length < STILL_IMAGE_PROGRESS_COUNT)
    return null;
  return { main: pickFrom(mainPart).time, progress };
}

export function extractStillImage(options: ExtractStillImageOptions): Promise<Buffer> {
  // Seeks the source again so the still is not limited to the 320 px sprite frame
  const filters = [options.width ? `scale=min(${options.width}\\,iw):-2` : `scale=-2:min(${options.height}\\,ih)`];
  if (options.isHDR)
    filters.unshift(...hdrTonemapFilters(options.hdrSource ?? { transfer: HDRTransfer.PQ }));
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (options.useURLInput)
    args.push(...ffmpegHelper.urlInputArgs());
  args.push('-ss', String(options.time), '-i', options.source, '-frames:v', '1', '-vf', filters.join(','), '-f', 'image2pipe', '-c:v', 'png', 'pipe:1');
  return new Promise((resolve, reject) => {
    const ffmpeg = spawnUnshelled(options.ffmpegDir, 'ffmpeg', args);
    const chunks: Buffer[] = [];
    let errors = '';
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (data: string) => errors += data);
    ffmpeg.on('error', reject);
    ffmpeg.on('close', async (code: number) => {
      const png = Buffer.concat(chunks);
      if (code !== 0 || !png.length)
        return reject(new Error(`FFmpeg could not extract a still at ${options.time}s: ${errors.trim() || code}`));
      try {
        resolve(await sharp(png).avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer());
      } catch (e) {
        reject(e);
      }
    });
  });
}
