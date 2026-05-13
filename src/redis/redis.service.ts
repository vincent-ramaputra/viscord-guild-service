import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;

  async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      this.client = createClient({
        url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
      }) as RedisClientType;

      this.client.on('error', (err) => this.logger.error({ err }, 'Redis client error'));
      await this.client.connect();
    }

    return this.client;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
