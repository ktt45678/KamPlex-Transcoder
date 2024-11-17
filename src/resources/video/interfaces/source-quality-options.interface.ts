import { Job } from 'bullmq';
import path from 'path';

import { IVideoData } from './video-data.interface';

export interface ValidateSourceQualityOptions {
  parsedInput: path.ParsedPath;
  quality: number;
  qualityList: number[];
  forcedQualityList: number[];
  fallbackQualityList: number[];
  codec: number;
  retryFromInterruption: boolean;
  job: Job<IVideoData>;
}