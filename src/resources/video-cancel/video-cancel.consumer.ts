import { Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { TaskQueue } from '../../enums/task-queue.enum';
import { IJobData } from '../video/interfaces/job-data.interface';
import { VideoService } from '../video/video.service';

@Processor(TaskQueue.VIDEO_CANCEL, { concurrency: 1 })
export class VideoCancelConsumer extends WorkerHost {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) {
    super();
  }

  async process(job: Job<IJobData>) {
    this.videoService.addToCanceled(job.data);
    job.discard();
    return { cancel: true };
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type ${job.name}`);
  }
}
