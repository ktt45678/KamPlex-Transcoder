import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { VideoService } from './video.service';
import { VideoCosumer } from './video.consumer';
import { TaskQueue } from '../../enums/task-queue.enum';
import { KamplexApiModule } from '../../common/modules/kamplex-api';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TaskQueue.VIDEO_TRANSCODE,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true
      }
    }),
    KamplexApiModule
  ],
  providers: [VideoCosumer, VideoService],
  exports: [VideoService]
})
export class VideoModule { }
