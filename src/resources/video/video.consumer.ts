import { Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { VideoService } from './video.service';
import { TaskQueue } from '../../enums/task-queue.enum';
import { IVideoData } from './interfaces/video-data.interface';
import { VideoCodec } from '../../enums/video-codec.enum';

@Processor(`${TaskQueue.VIDEO_TRANSCODE}:${VideoCodec.H264}`, { concurrency: 1 })
export class VideoCosumerH264 extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<IVideoData, any, string>) {
    const result = await this.videoService.transcode(job, VideoCodec.H264);
    return result;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type H264`);
  }
}

@Processor(`${TaskQueue.VIDEO_TRANSCODE}:${VideoCodec.VP9}`, { concurrency: 1 })
export class VideoCosumerVP9 extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<IVideoData, any, string>) {
    const result = await this.videoService.transcode(job, VideoCodec.VP9);
    return result;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type VP9`);
  }
}

@Processor(`${TaskQueue.VIDEO_TRANSCODE}:${VideoCodec.AV1}`, { concurrency: 1 })
export class VideoCosumerAV1 extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<IVideoData, any, string>) {
    const result = await this.videoService.transcode(job, VideoCodec.AV1);
    return result;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type VP9`);
  }
}