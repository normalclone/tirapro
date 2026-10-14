import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

type Increment = ThrottlerStorage['increment'];
type IncrementResult = Awaited<ReturnType<Increment>>;

/**
 * Lưu bộ đếm rate-limit ở Redis để mọi node API dùng chung hạn mức; Redis không có/đang lỗi thì
 * rơi về bộ nhớ của node — rate-limit giảm cấp chứ không bao giờ làm request 500.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger('Throttler');
  private readonly memory = new ThrottlerStorageService();
  private warnedFallback = false;

  constructor(
    private readonly redisStorage: ThrottlerStorage | null,
    private readonly isRedisUp: () => boolean,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<IncrementResult> {
    if (this.redisStorage && this.isRedisUp()) {
      try {
        return await this.redisStorage.increment(key, ttl, limit, blockDuration, throttlerName);
      } catch (err) {
        if (!this.warnedFallback) {
          this.warnedFallback = true;
          this.logger.warn(`Redis lỗi (${(err as Error).message}) — rate-limit tạm dùng bộ nhớ của node.`);
        }
      }
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  onApplicationShutdown(): void {
    this.memory.onApplicationShutdown();
  }
}
