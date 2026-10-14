import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** Phần tối thiểu của ioredis mà khoá cron cần (để test bằng redis giả). */
export interface CronLockClient {
  set(key: string, value: string, mode: 'EX', ttlSec: number, flag: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** RedisService của app thoả cấu trúc này. */
export interface CronLockRedis {
  isAvailable(): boolean;
  getClient(): CronLockClient | null;
}

/** Chỉ xoá khoá nếu vẫn là của mình — tránh xoá nhầm khoá của node khác sau khi TTL hết hạn. */
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const logger = new Logger('CronLock');
let warnedNoRedis = false;

/** Chỉ dùng cho test: cho phép log lại cảnh báo "không có Redis". */
export function resetCronLockWarning(): void {
  warnedNoRedis = false;
}

/**
 * Chạy `fn` dưới khoá phân tán `lock:cron:<name>` (SET NX EX) để nhiều node API không chạy trùng cron.
 * - Không lấy được khoá → node khác đang chạy, bỏ qua lượt này (trả `false`).
 * - Không có Redis (hoặc Redis lỗi) → chạy `fn` trực tiếp như chế độ một node và chỉ log cảnh báo một lần.
 * - Kết thúc (kể cả lỗi) → DEL khoá nếu giá trị còn khớp.
 * Trả `true` nếu `fn` đã chạy.
 */
export async function withCronLock(
  redis: CronLockRedis,
  name: string,
  ttlSec: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = redis.isAvailable() ? redis.getClient() : null;
  if (!client) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      logger.warn('Không có Redis — cron chạy ở chế độ một node, không khoá phân tán.');
    }
    await fn();
    return true;
  }

  const key = `lock:cron:${name}`;
  const token = randomUUID();
  let acquired: 'OK' | null;
  try {
    acquired = await client.set(key, token, 'EX', ttlSec, 'NX');
  } catch (err) {
    logger.warn(`Không lấy được khoá cron ${name} (Redis lỗi: ${(err as Error).message}) — chạy trực tiếp.`);
    await fn();
    return true;
  }
  if (acquired !== 'OK') {
    logger.debug(`Cron ${name} đang chạy ở node khác — bỏ qua lượt này.`);
    return false;
  }

  try {
    await fn();
    return true;
  } finally {
    await client.eval(RELEASE_SCRIPT, 1, key, token).catch((err: Error) => {
      logger.warn(`Không nhả được khoá cron ${name}: ${err.message} (sẽ tự hết hạn sau ${ttlSec}s).`);
    });
  }
}
