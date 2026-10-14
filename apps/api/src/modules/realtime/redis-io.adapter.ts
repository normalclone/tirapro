import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { RedisService } from '../../infra/redis/redis.service';

/** CORS cho socket.io lấy từ cấu hình `api.corsOrigin` (cùng nguồn với REST), không mở toang `origin: true`. */
export function buildSocketCors(origins: string[] | undefined): ServerOptions['cors'] {
  return { origin: origins && origins.length > 0 ? origins : false, credentials: true };
}

/**
 * IoAdapter cấu hình theo config lúc chạy: CORS theo `api.corsOrigin`, và — khi Redis sẵn sàng
 * cùng `ws.useRedisAdapter` — gắn Redis adapter để nhiều node API chia sẻ room/broadcast.
 * Redis không có thì giảm cấp về in-memory (một node), app vẫn chạy.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private readonly config: ConfigService;
  private readonly redis: RedisService;

  constructor(app: INestApplicationContext) {
    super(app);
    this.config = app.get(ConfigService);
    this.redis = app.get(RedisService);
  }

  /** Chờ Redis kết nối tối đa `waitMs` rồi tạo adapter; trả true nếu đã bật. */
  async connectToRedis(waitMs = 3000): Promise<boolean> {
    if (!this.config.get<boolean>('ws.useRedisAdapter')) return false;
    const deadline = Date.now() + waitMs;
    while (!this.redis.isAvailable() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.redis.isAvailable()) {
      this.logger.warn('Redis chưa sẵn sàng — realtime chạy in-memory (chỉ đúng khi một node).');
      return false;
    }
    const pub = this.redis.duplicate();
    const sub = this.redis.duplicate();
    if (!pub || !sub) return false;
    const onError = (err: Error) => this.logger.warn(`Redis adapter lỗi: ${err.message}`);
    pub.on('error', onError);
    sub.on('error', onError);
    this.adapterConstructor = createAdapter(pub, sub);
    this.logger.log('Realtime dùng Redis adapter');
    return true;
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: buildSocketCors(this.config.get<string[]>('api.corsOrigin')),
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
