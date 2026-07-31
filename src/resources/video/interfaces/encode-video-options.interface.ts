import { ParsedPath } from 'path';
import { Job } from 'bullmq';

import { IEncodingSetting, IVideoData } from './video-data.interface';
import { StreamManifest } from '../../../utils';
import { ParsedHDRMetadataResult } from '../../../utils/hdr-metadata.util';
import { ExtractedHDRDynamicMetadata, FrameIndex } from '../../../utils/hdr-dynamic-metadata.util';
import { HDRTransfer } from '../../../utils/mediainfo.util';

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
  splitFrames?: number | null;
  segmentIndex?: number;
  hdr10PlusJsonFile?: string | null;
  outputFileName: string;
}

export interface SourceMetadata {
  hdrDynamicMetadata: ExtractedHDRDynamicMetadata;
  frameIndex: FrameIndex | null;
}

export interface ReadSourceMetadataOptions {
  source: string;
  isURL: boolean;
  inputFile: string;
  transcodeDir: string;
  parsedInput: ParsedPath;
  videoCodec: string;
  exactFps: string;
  hdrParams: ParsedHDRMetadataResult | null;
  allowTemporaryCopy: boolean;
  job: Job<IVideoData>;
}

export interface VideoSourceInfo {
  codec: string;
  duration: number;
  fps: number;
  exactFps?: string;
  frameIndex?: FrameIndex | null;
  bitrate: number;
  width: number;
  height: number;
  language: string | null;
  isHDR: boolean;
  hdrTransfer: HDRTransfer;
  sourceH264Params: string;
  hdrParams: ParsedHDRMetadataResult | null;
  hdrDynamicMetadata?: ExtractedHDRDynamicMetadata;
}

export interface AdvancedVideoSettings {
  h264Tune?: string;
  overrideSettings?: IEncodingSetting[];
}

export interface ResolveVideoFiltersOptions {
  quality?: number;
  hdrTonemap?: boolean;
  bitDepth?: number;
  sourceInfo?: VideoSourceInfo;
  useLibplacebo?: boolean;
}