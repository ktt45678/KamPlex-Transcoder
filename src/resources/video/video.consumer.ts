import { Inject } from '@nestjs/common';
import { Processor, Process, OnQueueActive } from '@nestjs/bull';
import { Job } from 'bull';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { VideoService } from './video.service';
import { TaskQueue } from '../../enums/task-queue.enum';
import { IVideoData } from './interfaces/video-data.interface';
import { StreamCodec } from '../../enums/stream-codec.enum';

@Processor(TaskQueue.VIDEO_TRANSCODE)
export class VideoCosumer {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) { }

  @Process({ name: StreamCodec.H264_AAC.toString(), concurrency: 1 })
  async transcodeH264AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.H264_AAC);
    await job.discard();
    return result;
  }

  @Process({ name: StreamCodec.VP9_AAC.toString(), concurrency: 0 })
  async transcodeVP9AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.VP9_AAC);
    await job.discard();
    return result;
  }

  /*
  @Process({ name: StreamCodec.AV1_AAC.toString(), concurrency: 0 })
  async transcodeAV1AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.AV1_AAC);
    await job.discard();
    return result;
  }
  */

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type ${job.name}`);
  }
}
