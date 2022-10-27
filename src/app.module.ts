import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VideoModule } from './resources/video/video.module';
import { VideoCancelModule } from './resources/video-cancel/video-cancel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        url: configService.get<string>('REDIS_QUEUE_URL')
      }),
      inject: [ConfigService],
    }),
    VideoModule,
    VideoCancelModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
