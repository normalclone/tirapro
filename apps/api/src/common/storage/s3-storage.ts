import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { normalizeKeyPrefix } from './s3-key-prefix';
import {
  ObjectExistsError,
  ObjectNotFoundError,
  StorageUnavailableError,
  assertSafeKey,
  type GetResult,
  type ListedObject,
  type ObjectStat,
  type ObjectStorage,
  type PutOptions,
  type PutResult,
  type StorageCheck,
} from './object-storage';

export interface S3StorageConfig {
  /** `http://host:port` (không SSL được phép — MinIO nội bộ). */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** MinIO cần path-style (`host/bucket/key`). */
  forcePathStyle: boolean;
  /**
   * Tiền tố khoá khi DÙNG CHUNG bucket với app khác (vd `tirapro/`). Mọi object gửi lên S3 có khoá = tiền tố + storageKey;
   * storageKey lưu trong DB KHÔNG có tiền tố (sau này chuyển sang bucket riêng chỉ cần sao chép và bỏ tiền tố).
   */
  keyPrefix?: string;
}

/** Tối thiểu của client để test tiêm bản giả. */
interface S3Like {
  send(command: never): Promise<unknown>;
}

/** Các lệnh S3 DUY NHẤT được phép gửi đi (không xoá hàng loạt, không liệt kê bucket, không tạo/xoá bucket, không copy). */
const ALLOWED_COMMANDS = [
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
] as const;

const REQUEST_TIMEOUT_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2;

const status = (e: unknown): number | undefined =>
  (e as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
const errName = (e: unknown): string => (e as { name?: string } | undefined)?.name ?? '';

/** "Không có tệp". `NoSuchBucket` KHÔNG tính (bucket mất/sai tên là sự cố cấu hình, không được che thành 404 im lặng). */
const isNotFound = (e: unknown) =>
  errName(e) !== 'NoSuchBucket' &&
  (status(e) === 404 || ['NoSuchKey', 'NotFound'].includes(errName(e)));
const isPreconditionFailed = (e: unknown) =>
  status(e) === 412 || status(e) === 409 || errName(e) === 'PreconditionFailed';

/**
 * Lưu trên S3/MinIO bằng `@aws-sdk/client-s3`. Khoá object = khoá lưu trữ (giống đường dẫn của LocalStorage).
 * Lỗi hạ tầng → `StorageUnavailableError` với thông báo chung; chi tiết nằm ở `cause` để log nội bộ.
 * Không bao giờ đưa khoá bí mật vào thông báo/log.
 */
export class S3Storage implements ObjectStorage {
  readonly driver = 's3' as const;
  readonly bucket: string;
  /** Tiền tố đã chuẩn hoá ('' = không có, hoặc kết thúc bằng `/`). */
  readonly keyPrefix: string;
  private readonly client: S3Like;

  constructor(cfg: S3StorageConfig, client?: S3Like) {
    this.bucket = cfg.bucket;
    this.keyPrefix = normalizeKeyPrefix(cfg.keyPrefix ?? '');
    this.client =
      client ??
      new S3Client({
        endpoint: cfg.endpoint,
        region: cfg.region,
        forcePathStyle: cfg.forcePathStyle,
        credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        maxAttempts: MAX_ATTEMPTS,
        requestHandler: {
          requestTimeout: REQUEST_TIMEOUT_MS,
          connectionTimeout: CONNECTION_TIMEOUT_MS,
        },
        // Tương thích MinIO/S3-clone cũ: không tự thêm checksum CRC32 mà server không đòi.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }

  /**
   * CHỐT CHẶN DUY NHẤT dựng khoá object gửi lên S3: kiểm khoá an toàn, gắn tiền tố, rồi assert kết quả thuộc tiền tố
   * (ném nếu không). Mọi lệnh theo khoá PHẢI dùng hàm này (có guard test `s3-key-guard.spec.ts`).
   */
  private objectKey(key: string): string {
    assertSafeKey(key);
    const full = this.keyPrefix + key;
    // Kiểm theo TỪNG ĐOẠN: chỉ đoạn đúng bằng "." hoặc ".." mới thoát được; tên như `a...png`, `report..final.pdf` hợp lệ.
    if (
      !full.startsWith(this.keyPrefix) ||
      full.split('/').some((seg) => seg === '.' || seg === '..')
    )
      throw new Error('Khoá lưu trữ không hợp lệ');
    return full;
  }

  /** Prefix cho ListObjectsV2: luôn nằm trong tiền tố (prefix rỗng = toàn bộ tiền tố, KHÔNG phải toàn bucket). */
  private listPrefix(prefix: string): string {
    return prefix === '' ? this.keyPrefix : this.objectKey(prefix);
  }

  /**
   * CHỐT CHẶN LÚC CHẠY trước MỌI lệnh (lớp thứ hai sau guard mã nguồn; bucket dùng chung với app khác): lệnh phải thuộc danh
   * sách cho phép, `Bucket` đúng bucket cấu hình, mọi `Key`/`Prefix` thuộc tiền tố, lệnh liệt kê luôn có `Prefix`.
   * Vi phạm → ném NGAY, chưa gọi mạng.
   */
  private assertCommandAllowed(command: object): void {
    const input = ((command as { input?: Record<string, unknown> }).input ?? {}) as {
      Bucket?: unknown;
      Key?: unknown;
      Prefix?: unknown;
    };
    const allowed = ALLOWED_COMMANDS.some((C) => command instanceof C);
    if (!allowed) throw new Error('Lệnh S3 không được phép');
    if (input.Bucket !== this.bucket) throw new Error('Lệnh S3 trỏ sai bucket');
    const inPrefix = (v: unknown) => typeof v === 'string' && v.startsWith(this.keyPrefix);
    if (command instanceof HeadBucketCommand) return;
    if (command instanceof ListObjectsV2Command) {
      if (typeof input.Prefix !== 'string' || !inPrefix(input.Prefix))
        throw new Error('Lệnh liệt kê S3 thiếu Prefix hoặc Prefix ngoài tiền tố');
      return;
    }
    if (typeof input.Key !== 'string' || input.Key === '' || !inPrefix(input.Key))
      throw new Error('Khoá S3 ngoài tiền tố');
    if (input.Key.split('/').some((seg) => seg === '.' || seg === '..'))
      throw new Error('Khoá S3 không hợp lệ');
  }

  private send<T>(command: object): Promise<T> {
    try {
      this.assertCommandAllowed(command);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return this.client.send(command as never) as Promise<T>;
  }

  async put(key: string, body: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    assertSafeKey(key);
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
          Body: body,
          ContentLength: body.length,
          ContentType: opts.contentType,
          ...(opts.ifNotExists ? { IfNoneMatch: '*' } : {}),
        }),
      );
    } catch (err) {
      if (opts.ifNotExists && isPreconditionFailed(err)) throw new ObjectExistsError(key);
      throw new StorageUnavailableError('Kho lưu trữ tệp không phản hồi', err);
    }
    return { key, checksum: createHash('sha256').update(body).digest('hex') };
  }

  async get(key: string): Promise<GetResult> {
    assertSafeKey(key);
    try {
      const out = await this.send<{
        Body?: unknown;
        ContentLength?: number;
        ContentType?: string;
      }>(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      if (!out.Body) throw new ObjectNotFoundError(key);
      return {
        stream: out.Body as Readable,
        size: out.ContentLength,
        contentType: out.ContentType,
      };
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw err;
      if (isNotFound(err)) throw new ObjectNotFoundError(key);
      throw new StorageUnavailableError('Kho lưu trữ tệp không phản hồi', err);
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    } catch (err) {
      if (isNotFound(err)) return; // S3 vốn trả 204 khi thiếu; phòng server khác trả 404
      throw new StorageUnavailableError('Kho lưu trữ tệp không phản hồi', err);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    assertSafeKey(key);
    try {
      const out = await this.send<{ ContentLength?: number; LastModified?: Date }>(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      return { size: out.ContentLength ?? 0, lastModified: out.LastModified ?? new Date(0) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new StorageUnavailableError('Kho lưu trữ tệp không phản hồi', err);
    }
  }

  async list(prefix: string, limit = 1000): Promise<ListedObject[]> {
    try {
      const out = await this.send<{
        Contents?: { Key?: string; Size?: number; LastModified?: Date }[];
      }>(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.listPrefix(prefix),
          MaxKeys: Math.min(Math.max(limit, 1), 1000),
        }),
      );
      return (out.Contents ?? [])
        .filter((o): o is { Key: string; Size?: number; LastModified?: Date } => !!o.Key)
        .filter((o) => o.Key.startsWith(this.keyPrefix)) // phòng máy chủ trả thừa: không bao giờ lộ object ngoài tiền tố
        .map((o) => ({
          key: o.Key.slice(this.keyPrefix.length),
          size: o.Size ?? 0,
          lastModified: o.LastModified ?? new Date(0),
        }));
    } catch (err) {
      throw new StorageUnavailableError('Kho lưu trữ tệp không phản hồi', err);
    }
  }

  /**
   * HeadBucket — KHÔNG bao giờ tạo bucket (tạo bucket là bước triển khai thủ công).
   * Phân loại lỗi: `network` CHỈ khi không có phản hồi HTTP (từ chối kết nối, DNS, timeout) hoặc 5xx/429/408 (có thể tự hết);
   * mọi lỗi khác đã nhận được phản hồi HTTP (404, 403, 400, 200 HTML của cổng console…) là `config` — không tự hết.
   */
  async check(): Promise<StorageCheck> {
    try {
      await this.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (err) {
      const st = status(err);
      const name = errName(err);
      if (name === 'RequestTimeTooSkewed' || name === 'RequestExpired')
        return {
          ok: false,
          kind: 'config',
          detail: `Đồng hồ máy chủ lệch với S3 (${name}) — kiểm tra NTP/đồng bộ giờ giữa máy chạy API và máy chủ S3 rồi khởi động lại.`,
        };
      if (st === 404 || name === 'NotFound' || name === 'NoSuchBucket')
        return {
          ok: false,
          kind: 'config',
          detail: `Bucket "${this.bucket}" không tồn tại — hãy tạo bucket thủ công trên MinIO/S3 (ứng dụng không tự tạo) rồi khởi động lại. Nếu bucket đã có, kiểm tra S3_ENDPOINT có đúng cổng API S3 không (thử HeadBucket để xác định cổng API; cổng còn lại thường là trang quản trị).`,
        };
      const wrongCredentials = ['InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(name);
      // Policy chỉ cho phép trong tiền tố thì HeadBucket (cần quyền cấp bucket) bị 403 dù thao tác trong tiền tố vẫn được:
      // thử liệt kê TRONG tiền tố; được thì coi là OK. Cả hai đều lỗi mới là `config`.
      if (this.keyPrefix && st === 403 && !wrongCredentials) {
        try {
          await this.send(
            new ListObjectsV2Command({
              Bucket: this.bucket,
              Prefix: this.listPrefix(''),
              MaxKeys: 1,
            }),
          );
          return {
            ok: true,
            note: `HeadBucket bị từ chối (403) nhưng liệt kê trong tiền tố "${this.keyPrefix}" được — policy của key chỉ cho phép thao tác trong tiền tố này; chấp nhận.`,
          };
        } catch {
          /* rơi xuống: sai quyền thật */
        }
      }
      if (
        st === 403 ||
        ['Forbidden', 'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(name)
      )
        return {
          ok: false,
          kind: 'config',
          detail: `Không đủ quyền truy cập bucket "${this.bucket}" hoặc sai khoá — kiểm tra S3_ACCESS_KEY/S3_SECRET_KEY và policy của tài khoản. Nếu chắc khoá đúng, kiểm tra đồng hồ máy chủ có lệch với S3 không (NTP).`,
        };
      const transient = st === undefined || st >= 500 || st === 429 || st === 408;
      if (transient)
        return {
          ok: false,
          kind: 'network',
          detail: `Không kết nối được tới S3 endpoint (${name || 'lỗi mạng'}) — kiểm tra S3_ENDPOINT (thử HeadBucket để xác định cổng API; MinIO thường tách cổng API S3 và cổng trang quản trị), mạng và tường lửa.`,
        };
      return {
        ok: false,
        kind: 'config',
        detail: `S3 endpoint trả phản hồi HTTP ${st} không phải của S3 (${name || 'không rõ lỗi'}). Có thể sai cổng S3 API (vd 9000 là console, 9001 là API) hoặc endpoint không phải S3 — kiểm tra S3_ENDPOINT (thử HeadBucket để xác định cổng API).`,
      };
    }
  }

  destroy(): void {
    (this.client as { destroy?: () => void }).destroy?.();
  }
}
