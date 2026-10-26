import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
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

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;

/**
 * Lưu trên đĩa dưới `STORAGE_LOCAL_DIR`. Khoá = đường dẫn tương đối ⇒ giữ NGUYÊN bố cục thư mục cũ
 * (`{ws}/{id}-{tên}`, `avatars/…`, `imports/…`, `system-settings.json`). Đây là nơi DUY NHẤT được dùng `fs` cho tệp người dùng
 * (có guard test `storage-guard.spec.ts`).
 */
export class LocalStorage implements ObjectStorage {
  readonly driver = 'local' as const;

  constructor(private readonly baseDir: string) {}

  private abs(key: string): string {
    assertSafeKey(key);
    return path.join(this.baseDir, key);
  }

  async put(key: string, body: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    const file = this.abs(key);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body, opts.ifNotExists ? { flag: 'wx' } : undefined);
    } catch (err) {
      if (opts.ifNotExists && code(err) === 'EEXIST') throw new ObjectExistsError(key);
      throw new StorageUnavailableError('Không ghi được tệp xuống đĩa', err);
    }
    return { key, checksum: createHash('sha256').update(body).digest('hex') };
  }

  async get(key: string): Promise<GetResult> {
    const file = this.abs(key);
    try {
      const st = await fs.stat(file);
      if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      return { stream: createReadStream(file), size: st.size };
    } catch (err) {
      if (code(err) === 'ENOENT' || code(err) === 'ENOTDIR') throw new ObjectNotFoundError(key);
      throw new StorageUnavailableError('Không đọc được tệp từ đĩa', err);
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.abs(key);
    try {
      await fs.unlink(file);
    } catch (err) {
      if (code(err) === 'ENOENT' || code(err) === 'ENOTDIR') return;
      throw new StorageUnavailableError('Không xoá được tệp trên đĩa', err);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    const file = this.abs(key);
    try {
      const st = await fs.stat(file);
      return st.isFile() ? { size: st.size, lastModified: st.mtime } : null;
    } catch (err) {
      if (code(err) === 'ENOENT' || code(err) === 'ENOTDIR') return null;
      throw new StorageUnavailableError('Không đọc được thông tin tệp', err);
    }
  }

  async list(prefix: string, limit = 1000): Promise<ListedObject[]> {
    // Tiền tố dạng thư mục (`imports/`) hoặc tiền tố tên (`imports/ab`): tách phần thư mục + phần đầu tên.
    const slash = prefix.lastIndexOf('/');
    const dirPart = slash >= 0 ? prefix.slice(0, slash) : '';
    const namePart = slash >= 0 ? prefix.slice(slash + 1) : prefix;
    if (dirPart) assertSafeKey(dirPart);
    const dir = path.join(this.baseDir, dirPart);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if (code(err) === 'ENOENT' || code(err) === 'ENOTDIR') return [];
      throw new StorageUnavailableError('Không liệt kê được thư mục', err);
    }
    const out: ListedObject[] = [];
    for (const name of names) {
      if (out.length >= limit) break;
      if (!name.startsWith(namePart)) continue;
      try {
        const st = await fs.stat(path.join(dir, name));
        if (st.isFile())
          out.push({
            key: dirPart ? `${dirPart}/${name}` : name,
            size: st.size,
            lastModified: st.mtime,
          });
      } catch {
        // tệp biến mất giữa chừng — bỏ qua
      }
    }
    return out;
  }

  check(): Promise<StorageCheck> {
    return Promise.resolve({ ok: true });
  }
}
