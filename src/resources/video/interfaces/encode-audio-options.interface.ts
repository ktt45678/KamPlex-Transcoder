import { Job } from 'bullmq';
import { ParsedPath } from 'path';
import FFprobe from 'ffprobe-client';

import { StreamManifest } from '../../../utils';
import { IVideoData } from './video-data.interface';

export interface EncodeAudioByTrackOptions {
  inputFile: string;
  parsedInput: ParsedPath;
  type: 'normal' | 'surround';
  audioTrack: FFprobe.FFProbeStream;
  audioAACParams: string[];
  audioOpusParams: string[];
  isDefault: boolean;
  downmix: boolean;
  language?: string | null;
  manifest: StreamManifest;
  job: Job<IVideoData>;
}

export interface EncodeAudioOptions {
  inputFile: string;
  parsedInput: ParsedPath;
  sourceInfo: AudioSourceInfo;
  audioTrackIndex: number;
  codec: number;
  isDefault: boolean;
  downmix: boolean;
  audioParams: string[];
  manifest: StreamManifest;
  job: Job<IVideoData>;
}

export interface CreateAudioEncodingArgsOptions {
  inputFile: string;
  parsedInput: ParsedPath;
  audioParams: string[];
  codec: number;
  channels: number;
  downmix: boolean;
  audioIndex: number;
}

export interface AudioSourceInfo {
  duration: number;
  channels: number;
  language?: string | null;
}