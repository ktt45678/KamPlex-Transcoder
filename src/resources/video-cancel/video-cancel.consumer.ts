import { Inject } from '@nestjs/common';
import { OnQueueActive, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { TaskQueue } from '../../enums/task-queue.enum';
import { IJobData } from '../video/interfaces/job-data.interface';
import { VideoService } from '../video/video.service';

@Processor(TaskQueue.VIDEO_CANCEL)
export class VideoCancelConsumer {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private readonly videoService: VideoService) { }

  @Process({ name: 'cancel', concurrency: 1 })
  async cancelRunningJob(job: Job<IJobData>) {
    this.videoService.addToCanceled(job);
    await job.discard();
    return { cancel: true };
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.info(`Processing job ${job.id} of type ${job.name}`);
  }
}
