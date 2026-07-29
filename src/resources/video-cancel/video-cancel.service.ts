import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OnPubSubMessage } from '../../common/modules/redis-pubsub';
import { VideoService } from '../video/video.service';
import { TranscodeJob } from '../video/entities/transcode-job.entity';
import { VideoCodec } from '../../enums';

@Injectable()
export class VideoCancelService {
  constructor(private configService: ConfigService, private readonly videoService: VideoService) { }

  @OnPubSubMessage('video-cancel')
  onVideoCancelMessage(message: string) {
    const consumerCodec = Number(this.configService.get<string>('VIDEO_CODEC')) || VideoCodec.H264;
    const data: { tJobs: TranscodeJob[] } = JSON.parse(message);
    const tJob = data.tJobs.find(j => j.codec === consumerCodec);
    if (!tJob) return;
    this.videoService.addToCanceled({ ids: tJob.ids });
  }
}
