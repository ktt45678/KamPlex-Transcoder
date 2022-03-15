import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { VideoService } from './video.service';
import { VideoCosumer } from './video.consumer';
import { TaskQueue } from '../../enums/task-queue.enum';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TaskQueue.VIDEO_TRANSCODE,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 10,
        attempts: 3
      }
    })
  ],
  providers: [VideoCosumer, VideoService]
})
export class VideoModule { }
