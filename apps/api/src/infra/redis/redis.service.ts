import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Bọc ioredis với DEGRADE GRACEFULLY: nếu Redis không kết nối được, app vẫn boot.
 * isAvailable() cho biết có dùng được realtime adapter / cache / presence không.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private available = false;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      this.logger.warn('REDIS_URL trống — chạy không có Redis (realtime/cache giảm cấp).');
      return;
    }
    try {
      this.client = new Redis(url, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
        enableOfflineQueue: false,
      });
      this.client.on('ready', () => {
        this.available = true;
        this.logger.log('Redis connected');
      });
      this.client.on('error', (err) => {
        if (this.available) this.logger.warn(`Redis error: ${err.message}`);
        this.available = false;
      });
      this.client.on('end', () => {
        this.available = false;
      });
    } catch (err) {
      this.logger.warn(`Không khởi tạo được Redis: ${(err as Error).message}`);
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  /** Client thô (có thể null nếu Redis không sẵn sàng). */
  getClient(): Redis | null {
    return this.client;
  }

  /** Tạo client mới (cho socket.io adapter pub/sub — cần kết nối riêng). */
  duplicate(): Redis | null {
    return this.client ? this.client.duplicate() : null;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
    }
  }
}
