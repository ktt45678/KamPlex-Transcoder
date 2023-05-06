import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { utilities as nestWinstonModuleUtilities, WinstonModule } from 'nest-winston';
import { parseRedisUrl } from 'parse-redis-url-simple';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

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
      useFactory: async (configService: ConfigService) => {
        const [parsedUrl] = parseRedisUrl(configService.get<string>('REDIS_QUEUE_URL'));
        return {
          connection: {
            host: parsedUrl.host,
            port: parsedUrl.port,
            password: parsedUrl.password,
            db: +parsedUrl.database
          }
        };
      },
      inject: [ConfigService],
    }),
    WinstonModule.forRoot({
      levels: { emerg: 0, alert: 1, crit: 2, error: 3, warning: 4, notice: 5, info: 6, debug: 7 },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.ms(),
            nestWinstonModuleUtilities.format.nestLike('Logger')
          )
        }),
        new winston.transports.DailyRotateFile({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
          filename: 'info_%DATE%.log',
          dirname: 'logs',
          datePattern: 'YYYY-MM-DD',
          maxFiles: 300,
          auditFile: 'logs/audit.json',
          level: 'info'
        })
      ]
    }),
    VideoModule,
    VideoCancelModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
