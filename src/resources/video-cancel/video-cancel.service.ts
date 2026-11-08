import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { OnPubSubMessage } from '../../common/modules/redis-pubsub';
import { VideoService } from '../video/video.service';
import { TranscodeJob } from '../video/entities/transcode-job.entity';
import { VideoCodec } from '../../enums';

@Injectable()
export class VideoCancelService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private configService: ConfigService, private readonly videoService: VideoService) { }

  @OnPubSubMessage('video-cancel')
  onVideoCancelMessage(message: string) {
    const consumerCodec = Number(this.configService.get<string>('VIDEO_CODEC')) || VideoCodec.H264;
    try {
      const data: { tJobs: TranscodeJob[], canceledAt?: number } = JSON.parse(message);
      const tJob = data.tJobs.find(j => j.codec === consumerCodec);
      if (!tJob) return;
      this.videoService.addToCanceled({ ids: tJob.ids, canceledAt: data.canceledAt });
    } catch (e) {
      this.logger.error(`Failed to read a video cancel message: ${e.message}`);
    }
  }
}
