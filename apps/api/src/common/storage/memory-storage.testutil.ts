import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ObjectExistsError,
  ObjectNotFoundError,
  assertSafeKey,
  type GetResult,
  type ListedObject,
  type ObjectStat,
  type ObjectStorage,
  type PutOptions,
  type PutResult,
} from './object-storage';

/** `ObjectStorage` trong bộ nhớ cho test điểm chạm (không đụng đĩa/mạng). Có thể bơm lỗi qua `failNext`. */
export class MemoryStorage implements ObjectStorage {
  readonly driver: 'local' | 's3' = 'local';
  readonly files = new Map<string, { body: Buffer; contentType?: string; lastModified: Date }>();
  /** Lỗi ném ở lần gọi kế tiếp của phương thức tương ứng. */
  failNext: Partial<Record<'put' | 'get' | 'delete' | 'stat' | 'list', Error>> = {};

  private maybeFail(op: keyof MemoryStorage['failNext']): void {
    const e = this.failNext[op];
    if (e) {
      delete this.failNext[op];
      throw e;
    }
  }

  put(key: string, body: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    return this.run(() => {
      assertSafeKey(key);
      this.maybeFail('put');
      if (opts.ifNotExists && this.files.has(key)) throw new ObjectExistsError(key);
      this.files.set(key, {
        body: Buffer.from(body),
        contentType: opts.contentType,
        lastModified: new Date(),
      });
      return { key, checksum: createHash('sha256').update(body).digest('hex') };
    });
  }

  get(key: string): Promise<GetResult> {
    return this.run(() => {
      assertSafeKey(key);
      this.maybeFail('get');
      const f = this.files.get(key);
      if (!f) throw new ObjectNotFoundError(key);
      return { stream: Readable.from([f.body]), size: f.body.length, contentType: f.contentType };
    });
  }

  delete(key: string): Promise<void> {
    return this.run(() => {
      assertSafeKey(key);
      this.maybeFail('delete');
      this.files.delete(key);
    });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  stat(key: string): Promise<ObjectStat | null> {
    return this.run(() => {
      assertSafeKey(key);
      this.maybeFail('stat');
      const f = this.files.get(key);
      return f ? { size: f.body.length, lastModified: f.lastModified } : null;
    });
  }

  list(prefix: string): Promise<ListedObject[]> {
    return this.run(() => {
      this.maybeFail('list');
      return [...this.files.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, f]) => ({ key, size: f.body.length, lastModified: f.lastModified }));
    });
  }

  /** Mọi lỗi (kể cả đồng bộ) thành Promise bị từ chối — giống cài đặt thật. */
  private run<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  check(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve({ ok: true });
  }
}
