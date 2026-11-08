import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { RedisClientType, TimeoutError } from '@redis/client';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { ON_PUBSUB_MESSAGE_EVENT_METADATA, REDIS_PUBSUB_CONFIG } from './redis-pubsub.constants';
import { RedisPubSubConfig } from './redis-pubsub-config.interface';

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logIntervalMS = 10000;
  private readonly commandTimeoutMS = 3000;
  private lastLogAt = 0;
  redis: RedisClientType;
  private subscriber: RedisClientType;

  constructor(
    @Inject(REDIS_PUBSUB_CONFIG) public config: RedisPubSubConfig,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {
    this.redis = config.redisInstance;
    // Subscribers use their own connection, because functions like publish will be disabled then
    this.subscriber = this.redis.duplicate();
  }

  onModuleInit() {
    // Error listener
    this.redis.on('error', e => this.logFailure(e));
    this.subscriber.on('error', e => this.logFailure(e));
    this.redis.connect().catch(e => this.logFailure(e));
    this.subscribeAll().catch(e => this.logFailure(e));
  }

  async onModuleDestroy() {
    const clients = [this.subscriber, this.redis].filter(client => client?.isOpen);
    await Promise.all(clients.map(client => client.close().catch(() => client.destroy())));
  }

  async publish(channel: string, message: string) {
    await this.redis.publish(channel, message);
  }

  async publishJson(channel: string, message: Object) {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  async get(key: string) {
    try {
      return await this.redis.withCommandOptions({ timeout: this.commandTimeoutMS }).get(key);
    } catch (e) {
      if (e instanceof TimeoutError)
        throw new Error(`Redis command timed out after ${this.commandTimeoutMS} ms`);
      throw e;
    }
  }

  onReady(listener: () => void) {
    // Both connections, because messages are only safe once the later of the two is back
    this.redis.on('ready', listener);
    this.subscriber.on('ready', listener);
  }

  private async subscribeAll() {
    await this.subscriber.connect();
    const providers = this.discoveryService.getProviders();
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const instance = provider.instance;
      if (instance) {
        const prototype = Object.getPrototypeOf(instance);
        const methods = this.metadataScanner.getAllMethodNames(prototype);
        for (let j = 0; j < methods.length; j++) {
          const method = methods[j];
          const channelConfig = Reflect.getMetadata(ON_PUBSUB_MESSAGE_EVENT_METADATA, instance[method]);
          if (channelConfig) {
            await this.subscriber.subscribe(channelConfig.channel, message => instance[method](message));
          }
        }
      }
    }
  }

  private logFailure(e: Error) {
    const now = Date.now();
    if (now - this.lastLogAt < this.logIntervalMS)
      return;
    this.lastLogAt = now;
    this.logger.error(`Pub/sub connection failed: ${e.message}`);
  }
}
