import { Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { VideoService } from './video.service';
import { TaskQueue } from '../../enums/task-queue.enum';
import { IVideoData } from './interfaces/video-data.interface';
import { StreamCodec } from '../../enums/stream-codec.enum';

@Processor(TaskQueue.VIDEO_TRANSCODE, { concurrency: 1 })
export class VideoCosumer extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<IVideoData, any, string>) {
    let result: Awaited<ReturnType<typeof this.videoService.transcode>>;
    switch (job.name) {
      case StreamCodec.H264_AAC.toString(): {
        result = await this.videoService.transcode(job, StreamCodec.H264_AAC);
        break;
      }
      case StreamCodec.VP9_AAC.toString(): {
        result = await this.videoService.transcode(job, StreamCodec.VP9_AAC);
        break;
      }
      case StreamCodec.AV1_AAC.toString(): {
        result = await this.videoService.transcode(job, StreamCodec.AV1_AAC);
        break;
      }
      default: {
        result = await this.videoService.transcode(job, StreamCodec.H264_AAC);
        break;
      }
    }
    return result;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type ${job.name}`);
  }
}
