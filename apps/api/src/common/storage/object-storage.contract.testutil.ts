import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectExistsError, ObjectNotFoundError, type ObjectStorage } from './object-storage';

/** Đọc hết một stream thành Buffer. */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

export interface ContractSubject {
  storage: ObjectStorage;
  cleanup: () => Promise<void>;
}

/**
 * Bộ test HỢP ĐỒNG chung cho mọi cài đặt `ObjectStorage` (Local, S3 với client giả, S3 thật qua int-spec).
 * `prefix` cách ly khoá giữa các lần chạy khi dùng chung một bucket.
 */
export function runObjectStorageContract(
  name: string,
  create: () => Promise<ContractSubject>,
  prefix = 'contract',
): void {
  describe(`ObjectStorage — hợp đồng chung (${name})`, () => {
    let subject: ContractSubject;
    let s: ObjectStorage;
    const k = (rest: string) => `${prefix}/${rest}`;

    beforeAll(async () => {
      subject = await create();
      s = subject.storage;
    });
    afterAll(async () => {
      await subject.cleanup();
    });

    it('put → get trả đúng nội dung, kích thước; put trả key + checksum sha256', async () => {
      const body = Buffer.from('xin chào — nội dung có dấu', 'utf8');
      const res = await s.put(k('ws1/a-file.txt'), body, {
        contentType: 'text/plain',
        size: body.length,
      });
      expect(res.key).toBe(k('ws1/a-file.txt'));
      expect(res.checksum).toBe(createHash('sha256').update(body).digest('hex'));
      const got = await s.get(k('ws1/a-file.txt'));
      expect((await readAll(got.stream)).equals(body)).toBe(true);
      expect(got.size).toBe(body.length);
    });

    it('lưu nhị phân nguyên vẹn (mọi giá trị byte)', async () => {
      const body = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      await s.put(k('bin.dat'), body, { contentType: 'application/octet-stream' });
      expect((await readAll((await s.get(k('bin.dat'))).stream)).equals(body)).toBe(true);
    });

    it('put cùng khoá ghi đè', async () => {
      await s.put(k('over.txt'), Buffer.from('một'));
      await s.put(k('over.txt'), Buffer.from('hai!'));
      expect((await readAll((await s.get(k('over.txt'))).stream)).toString()).toBe('hai!');
    });

    it('get khoá không tồn tại → ObjectNotFoundError', async () => {
      await expect(s.get(k('khong-co.txt'))).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it('exists / stat phản ánh đúng', async () => {
      await s.put(k('ex.txt'), Buffer.from('abc'));
      expect(await s.exists(k('ex.txt'))).toBe(true);
      expect(await s.exists(k('khong-co.txt'))).toBe(false);
      const st = await s.stat(k('ex.txt'));
      expect(st?.size).toBe(3);
      expect(st?.lastModified).toBeInstanceOf(Date);
      expect(await s.stat(k('khong-co.txt'))).toBeNull();
    });

    it('delete: xoá được và idempotent (thiếu object không lỗi)', async () => {
      await s.put(k('del.txt'), Buffer.from('x'));
      await s.delete(k('del.txt'));
      expect(await s.exists(k('del.txt'))).toBe(false);
      await expect(s.delete(k('del.txt'))).resolves.toBeUndefined();
      await expect(s.delete(k('chua-bao-gio-co.txt'))).resolves.toBeUndefined();
    });

    it('ifNotExists: lần hai báo ObjectExistsError và KHÔNG ghi đè', async () => {
      await s.put(k('once.txt'), Buffer.from('dau'), { ifNotExists: true });
      await expect(
        s.put(k('once.txt'), Buffer.from('sau'), { ifNotExists: true }),
      ).rejects.toBeInstanceOf(ObjectExistsError);
      expect((await readAll((await s.get(k('once.txt'))).stream)).toString()).toBe('dau');
    });

    it('list theo tiền tố: trả khoá + kích thước + thời điểm sửa, không lẫn tiền tố khác', async () => {
      await s.put(k('lst/a.txt'), Buffer.from('1'));
      await s.put(k('lst/b.txt'), Buffer.from('22'));
      await s.put(k('lstx/c.txt'), Buffer.from('333'));
      const out = await s.list(k('lst/'));
      expect(out.map((o) => o.key).sort()).toEqual([k('lst/a.txt'), k('lst/b.txt')]);
      expect(out.find((o) => o.key === k('lst/b.txt'))?.size).toBe(2);
      expect(out[0]?.lastModified).toBeInstanceOf(Date);
      expect(await s.list(k('khong-co-tien-to/'))).toEqual([]);
    });

    it('từ chối khoá không an toàn (path traversal, tuyệt đối, rỗng, NUL)', async () => {
      for (const bad of ['../x', 'a/../../x', '/etc/passwd', '', 'a\0b', 'a\\..\\b']) {
        await expect(s.put(bad, Buffer.from('x'))).rejects.toThrow(/khoá/i);
        await expect(s.get(bad)).rejects.toThrow(/khoá/i);
        await expect(s.delete(bad)).rejects.toThrow(/khoá/i);
      }
    });
  });
}
