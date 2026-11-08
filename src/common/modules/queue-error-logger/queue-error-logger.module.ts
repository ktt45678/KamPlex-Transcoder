import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { QueueErrorLoggerService } from './queue-error-logger.service';

@Module({
  imports: [DiscoveryModule],
  providers: [QueueErrorLoggerService]
})
export class QueueErrorLoggerModule { }
