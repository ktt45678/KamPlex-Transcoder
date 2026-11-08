import { RedisClientType } from '@redis/client';

export interface RedisPubSubConfig {
  redisInstance: RedisClientType;
}
