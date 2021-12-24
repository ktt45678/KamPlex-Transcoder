import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VideoModule } from './resources/video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true
    }),
    BullModule.forRoot({
      redis: <any>process.env.REDIS_QUEUE_URL
    }),
    VideoModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
