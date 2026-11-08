import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class QueueErrorLoggerService implements OnApplicationBootstrap {
  private readonly logIntervalMS = 30000;
  private lastLogAt = 0;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private discoveryService: DiscoveryService) { }

  onApplicationBootstrap() {
    for (const { instance } of this.discoveryService.getProviders()) {
      if (instance instanceof Queue)
        instance.on('error', e => this.logFailure(e));
      else if (instance instanceof WorkerHost)
        instance.worker.on('error', e => this.logFailure(e));
    }
  }

  private logFailure(e: Error) {
    const now = Date.now();
    if (now - this.lastLogAt < this.logIntervalMS)
      return;
    this.lastLogAt = now;
    this.logger.error(`Queue connection failed: ${e.message}`);
  }
}
