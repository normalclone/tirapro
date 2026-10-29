import type { Readable } from 'node:stream';
import type { Logger } from '@nestjs/common';
import { BusinessRuleException } from '../exceptions/app.exception';

/** Token DI của lớp lưu trữ tệp (cài đặt chọn theo `STORAGE_DRIVER`, xem `storage.module.ts`). */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface PutOptions {
  contentType?: string;
  /** Kích thước byte (gợi ý; S3 dùng làm Content-Length). */
  size?: number;
  /** Chỉ ghi nếu khoá CHƯA tồn tại (nguyên tử); trùng → `ObjectExistsError`. */
  ifNotExists?: boolean;
}
export interface PutResult {
  key: string;
  /** sha256 hex của nội dung. */
  checksum: string;
}
export interface GetResult {
  stream: Readable;
  size?: number;
  contentType?: string;
}
export interface ObjectStat {
  size: number;
  lastModified: Date;
}
export interface ListedObject extends ObjectStat {
  key: string;
}
export interface StorageCheck {
  ok: boolean;
  /**
   * Khi `ok=false`: `config` = lỗi cấu hình dứt khoá (bucket không có, sai quyền/khoá) — không tự hết;
   * `network` = mạng/timeout/máy chủ lỗi — có thể tự hết.
   */
  kind?: 'config' | 'network';
  /** Mô tả lỗi đọc được (tiếng Việt) — KHÔNG chứa khoá bí mật. */
  detail?: string;
  /** Ghi chú khi `ok=true` nhưng đáng chú ý (vd policy chỉ cho phép trong tiền tố). */
  note?: string;
}

/**
 * Lớp lưu trữ tệp dùng chung. Mọi tệp người dùng (đính kèm, ảnh, tệp import, cờ hệ thống) đi qua đây.
 * Định dạng khoá giữ nguyên với đường dẫn tương đối dưới `STORAGE_LOCAL_DIR` ⇒ chuyển local → S3 chỉ là sao chép.
 */
export interface ObjectStorage {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, opts?: PutOptions): Promise<PutResult>;
  /** Ném `ObjectNotFoundError` nếu không có. Luồng trả về do người gọi tiêu thụ. */
  get(key: string): Promise<GetResult>;
  /** Idempotent: thiếu object không lỗi. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** `null` nếu không có. */
  stat(key: string): Promise<ObjectStat | null>;
  /** Liệt kê theo tiền tố (tối đa `limit`, mặc định 1000) — chỉ dùng cho thư mục nhỏ (vd `imports/`). */
  list(prefix: string, limit?: number): Promise<ListedObject[]>;
  /** Kiểm tra sức khoẻ cấu hình (S3: HeadBucket). Không ném. */
  check(): Promise<StorageCheck>;
  /** Giải phóng tài nguyên (socket của client S3) khi tắt ứng dụng. */
  destroy?(): void;
}

export class ObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Không tìm thấy tệp trong kho lưu trữ: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class ObjectExistsError extends Error {
  constructor(public readonly key: string) {
    super(`Tệp đã tồn tại trong kho lưu trữ: ${key}`);
    this.name = 'ObjectExistsError';
  }
}

/** Kho lưu trữ không dùng được (mạng, timeout, quyền, đĩa đầy…). `message` an toàn để hiển thị; chi tiết ở `cause`. */
export class StorageUnavailableError extends Error {
  constructor(
    message = 'Kho lưu trữ tệp không phản hồi',
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/** Khoá phải là đường dẫn tương đối an toàn: không rỗng, không `..`, không tuyệt đối, không NUL/`\`. */
export function assertSafeKey(key: string): void {
  const bad =
    typeof key !== 'string' ||
    key.length === 0 ||
    Buffer.byteLength(key) > 1024 ||
    key.startsWith('/') ||
    key.includes('\0') ||
    key.includes('\\') ||
    key.split('/').some((seg) => seg === '..' || seg === '.');
  if (bad) throw new Error('Khoá lưu trữ không hợp lệ');
}

/** Đọc hết một luồng thành Buffer (tệp đã giới hạn kích thước nên an toàn bộ nhớ). */
export async function streamToBuffer(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

/** Lỗi gốc để ghi log nội bộ (không bao giờ đưa ra client). */
export function causeMessage(err: unknown): string {
  const inner = err instanceof StorageUnavailableError && err.cause ? err.cause : err;
  return inner instanceof Error ? `${inner.name}: ${inner.message}` : String(inner);
}

/**
 * Ghi tệp qua storage và đổi lỗi hạ tầng thành lỗi nghiệp vụ rõ, KHÔNG lộ chi tiết nội bộ.
 * Chi tiết (endpoint, mã lỗi…) chỉ vào log.
 */
export async function putOrThrowBusiness(
  logger: Logger,
  storage: ObjectStorage,
  key: string,
  body: Buffer,
  opts?: PutOptions,
): Promise<PutResult> {
  try {
    return await storage.put(key, body, opts);
  } catch (err) {
    logger.error(`Ghi tệp ${key} thất bại: ${causeMessage(err)}`);
    throw new BusinessRuleException('Không lưu được tệp, thử lại');
  }
}

/** Mở tệp để tải về: thiếu → `null` (người gọi tự dịch thành 404); lỗi hạ tầng → lỗi nghiệp vụ, không giả làm 404. */
export async function getOrNull(
  logger: Logger,
  storage: ObjectStorage,
  key: string,
): Promise<Awaited<ReturnType<ObjectStorage['get']>> | null> {
  try {
    return await storage.get(key);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    logger.error(`Đọc tệp ${key} thất bại: ${causeMessage(err)}`);
    throw new BusinessRuleException('Không tải được tệp, thử lại');
  }
}

/** Xoá best-effort: lỗi chỉ được log, không chặn thao tác của người dùng. */
export async function deleteBestEffort(
  logger: Logger,
  storage: ObjectStorage,
  key: string,
): Promise<void> {
  try {
    await storage.delete(key);
  } catch (err) {
    logger.warn(`Không xoá được tệp ${key} (bỏ qua, có thể dọn tay sau): ${causeMessage(err)}`);
  }
}
