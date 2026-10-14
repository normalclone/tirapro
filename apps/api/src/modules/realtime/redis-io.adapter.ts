import type { INestApplicationContext} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { RedisService } from '../../infra/redis/redis.service';

/** CORS cho socket.io lấy từ cấu hình `api.corsOrigin` (cùng nguồn với REST), không mở toang `origin: true`. */
export function buildSocketCors(origins: string[] | undefined): ServerOptions['cors'] {
  return { origin: origins && origins.length > 0 ? origins : false, credentials: true };
}

/** Backoff tăng dần, trần 10 giây, không bao giờ trả null (không bỏ cuộc). */
export function pubSubRetryStrategy(times: number): number {
  return Math.min(times * 200, 10_000);
}

/** Chờ client ioredis vào trạng thái ready; false nếu quá hạn hoặc kết nối đã đóng. */
function waitReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('end', onEnd);
      resolve(ok);
    };
    const onReady = () => done(true);
    const onEnd = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    client.once('ready', onReady);
    client.once('end', onEnd);
  });
}

/**
 * IoAdapter cấu hình theo config lúc chạy: CORS theo `api.corsOrigin`, và — khi Redis sẵn sàng
 * cùng `ws.useRedisAdapter` — gắn Redis adapter để nhiều node API chia sẻ room/broadcast.
 * Redis không có thì giảm cấp về in-memory (một node), app vẫn chạy.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
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
    // RedisService tắt offline queue; client pub/sub phải bật lại, nếu không lệnh (p)subscribe mà
    // createAdapter gửi ngay khi gắn adapter sẽ bị từ chối khi kết nối chưa xong → broadcast liên node im lặng hỏng.
    // retryStrategy ghi đè: client gốc bỏ cuộc sau 5 lần thử, còn pub/sub phải tự nối lại dù Redis chết lâu.
    const options = { enableOfflineQueue: true, retryStrategy: pubSubRetryStrategy };
    const pub = this.redis.duplicate(options);
    const sub = this.redis.duplicate(options);
    if (!pub || !sub) {
      pub?.disconnect();
      sub?.disconnect();
      return false;
    }
    const onError = (err: Error) => this.logger.warn(`Redis adapter lỗi: ${err.message}`);
    pub.on('error', onError);
    sub.on('error', onError);
    this.pubClient = pub;
    this.subClient = sub;

    const ready = await Promise.all([waitReady(pub, waitMs), waitReady(sub, waitMs)]);
    if (!ready.every(Boolean)) {
      this.logger.warn('Client pub/sub của Redis adapter không kết nối được — realtime chạy in-memory.');
      this.disconnectClients();
      return false;
    }
    this.adapterConstructor = createAdapter(pub, sub);
    this.logger.log('Realtime dùng Redis adapter');
    return true;
  }

  /** Đóng hai kết nối pub/sub khi app tắt (RedisService chỉ đóng client gốc). */
  override async dispose(): Promise<void> {
    await super.dispose();
    this.disconnectClients();
  }

  private disconnectClients(): void {
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
    this.pubClient = null;
    this.subClient = null;
    this.adapterConstructor = null;
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
