import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';

import { VideoModule } from '../video/video.module';
import { VideoCancelConsumer } from './video-cancel.consumer';
import { VideoCancelService } from './video-cancel.service';
import { RedisPubSubModule } from '../../common/modules/redis-pubsub';
import { TaskQueue } from '../../enums/task-queue.enum';

@Module({
  imports: [
    VideoModule,
    BullModule.registerQueue({
      name: TaskQueue.VIDEO_CANCEL,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3
      }
    }),
    RedisPubSubModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redisInstance: new Redis(configService.get<string>('REDIS_QUEUE_URL'))
      })
    })
  ],
  providers: [VideoCancelConsumer, VideoCancelService]
})
export class VideoCancelModule { }
