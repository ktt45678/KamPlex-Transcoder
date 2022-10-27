import { OnQueueActive, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

import { TaskQueue } from '../../enums/task-queue.enum';
import { IJobData } from '../video/interfaces/job-data.interface';
import { VideoService } from '../video/video.service';

@Processor(TaskQueue.VIDEO_CANCEL)
export class VideoCancelConsumer {
  constructor(private readonly videoService: VideoService) { }

  @Process({ name: 'cancel', concurrency: 1 })
  async cancelRunningJob(job: Job<IJobData>) {
    this.videoService.addToCanceled(job);
    await job.discard();
    return { cancel: true };
  }

  @OnQueueActive()
  onActive(job: Job) {
    console.log('\x1b[33m%s\x1b[0m', `Processing job ${job.id} of type ${job.name}`);
  }
}
