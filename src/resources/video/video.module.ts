import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { VideoService } from './video.service';
import { BaseVideoConsumer, VideoCosumerAV1, VideoCosumerH264, VideoCosumerVP9 } from './video.consumer';
import { KamplexApiModule } from '../../common/modules/kamplex-api';
import { TaskQueue, VideoCodec } from '../../enums';
import { VideoController } from './video.controller';

const targetConsumer = getTargetConsumer();

function getTargetConsumer() {
  const consumerCodec = +process.env.VIDEO_CODEC;
  if (consumerCodec === VideoCodec.AV1)
    return VideoCosumerAV1;
  else if (consumerCodec === VideoCodec.VP9)
    return VideoCosumerVP9;
  return VideoCosumerH264;
}

@Module({
  imports: [
    BullModule.registerQueue({
      name: TaskQueue.VIDEO_TRANSCODE_RESULT,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3
      }
    }),
    KamplexApiModule
  ],
  providers: [
    VideoService,
    {
      provide: BaseVideoConsumer,
      useClass: targetConsumer
    }
  ],
  exports: [VideoService],
  controllers: [VideoController]
})
export class VideoModule { }
