import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { VideoService } from './video.service';
import { VideoCosumerAV1, VideoCosumerH264, VideoCosumerVP9 } from './video.consumer';
import { KamplexApiModule } from '../../common/modules/kamplex-api';
import { TaskQueue, VideoCodec } from '../../enums';

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
  providers: [targetConsumer, VideoService],
  exports: [VideoService]
})
export class VideoModule { }
