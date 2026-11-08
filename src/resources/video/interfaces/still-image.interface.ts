import { HDRTonemapSource } from '../../../utils/hdr-tonemap.util';
import { FFProbeResult } from '../../../common/interfaces';

export interface CreateStillImagesOptions {
  source: string;
  framesPath: string;
  frameCount: number;
  duration: number;
  outputFolder: string;
  isHDR: boolean;
  hdrSource: HDRTonemapSource;
  ffmpegDir: string;
  useURLInput: boolean;
}

export interface StillImageFrame {
  file: string;
  placeholder: string;
}

export interface StillImageThumb {
  time: number;
  file: string;
}

export interface StillImagesResult {
  thumbs: StillImageThumb[];
  mainTime: number;
  mainFile: string;
}

export interface CreateThumbnailsOptions {
  source: string;
  useURLInput: boolean;
  outputDir: string;
  duration: number;
  isHDR: boolean;
  hdrSource: HDRTonemapSource;
  jobId: string | number;
}

export interface StillImagesInput {
  remote: string;
  folder: string;
  file: string;
  isLinked: boolean;
}

export interface RunStillOnlyOptions {
  source: string;
  useURLInput: boolean;
  transcodeDir: string;
  videoInfo: FFProbeResult;
  videoTrack: FFProbeResult['streams'][number];
}
