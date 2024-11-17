import { ParsedPath } from 'path';
import { Job } from 'bullmq';

import { IEncodingSetting, IVideoData } from './video-data.interface';
import { StreamManifest } from '../../../utils';

export interface EncodeVideoOptions {
  inputFile: string;
  parsedInput: ParsedPath;
  inputFileUrl: string;
  sourceInfo: VideoSourceInfo;
  qualityList: number[];
  encodingSettings: IEncodingSetting[];
  advancedSettings?: AdvancedVideoSettings;
  codec: number;
  videoParams: string[];
  manifest: StreamManifest;
  job: Job<IVideoData>;
}

export interface CreateVideoEncodingArgsOptions {
  inputFile: string;
  parsedInput: ParsedPath;
  codec: number;
  quality: number;
  videoParams: string[];
  sourceInfo: VideoSourceInfo;
  crfKey: 'crf' | 'cq';
  advancedSettings: AdvancedVideoSettings;
  encodingSetting?: IEncodingSetting;
  splitFrom?: string;
  splitDuration?: string;
  segmentIndex?: number;
}

export interface VideoSourceInfo {
  codec: string;
  duration: number;
  fps: number;
  bitrate: number;
  width: number;
  height: number;
  language: string | null;
  isHDR: boolean;
  sourceH264Params: string;
}

export interface AdvancedVideoSettings {
  h264Tune?: string;
  overrideSettings?: IEncodingSetting[];
}

export interface ResolveVideoFiltersOptions {
  quality?: number;
  hdrTonemap?: boolean;
}