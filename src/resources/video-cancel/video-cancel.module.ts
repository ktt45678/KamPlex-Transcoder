import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { VideoModule } from '../video/video.module';
import { VideoCancelConsumer } from './video-cancel.consumer';
import { TaskQueue } from '../../enums/task-queue.enum';

@Module({
  imports: [
    VideoModule,
    BullModule.registerQueue({
      name: TaskQueue.VIDEO_CANCEL,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true
      }
    })
  ],
  providers: [VideoCancelConsumer]
})
export class VideoCancelModule { }
