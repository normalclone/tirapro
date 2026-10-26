import { describe, expect, it } from 'vitest';
import { FakeS3Client, awsError } from './fake-s3-client.testutil';
import { runObjectStorageContract } from './object-storage.contract.testutil';
import { ObjectExistsError, ObjectNotFoundError, StorageUnavailableError } from './object-storage';
import { S3Storage } from './s3-storage';

const SECRET = 'SUPER-SECRET-KEY-do-not-leak';
const mk = (client = new FakeS3Client()) => ({
  client,
  storage: new S3Storage(
    {
      endpoint: 'http://127.0.0.1:9100',
      region: 'us-east-1',
      bucket: 'bucket-test',
      accessKey: 'AK',
      secretKey: SECRET,
      forcePathStyle: true,
    },
    client,
  ),
});

runObjectStorageContract('S3Storage + client giả', () =>
  Promise.resolve({ storage: mk().storage, cleanup: () => Promise.resolve() }),
);

describe('S3Storage — tham số gửi lên S3', () => {
  it('put: đúng Bucket/Key/ContentType/ContentLength', async () => {
    const { storage, client } = mk();
    await storage.put('ws/a.png', Buffer.from('12345'), { contentType: 'image/png' });
    const call = client.calls.find((c) => c.command === 'PutObjectCommand');
    expect(call?.input).toMatchObject({
      Bucket: 'bucket-test',
      Key: 'ws/a.png',
      ContentType: 'image/png',
      ContentLength: 5,
    });
    expect(call?.input.IfNoneMatch).toBeUndefined();
  });

  it('put ifNotExists gửi If-None-Match: *', async () => {
    const { storage, client } = mk();
    await storage.put('k', Buffer.from('1'), { ifNotExists: true });
    expect(client.calls[0]?.input.IfNoneMatch).toBe('*');
  });

  it('get trả contentType + size từ S3', async () => {
    const { storage } = mk();
    await storage.put('k.png', Buffer.from('abc'), { contentType: 'image/png' });
    const g = await storage.get('k.png');
    expect(g.contentType).toBe('image/png');
    expect(g.size).toBe(3);
  });

  it('driver = s3, bucket lộ ra để hiển thị (khoá thì không)', () => {
    const { storage } = mk();
    expect(storage.driver).toBe('s3');
    expect(storage.bucket).toBe('bucket-test');
    expect(JSON.stringify(Object.values(storage))).not.toContain(SECRET);
  });
});

describe('S3Storage — ánh xạ lỗi', () => {
  it('NoSuchKey/404 → ObjectNotFoundError; 412 → ObjectExistsError', async () => {
    const { storage } = mk();
    await expect(storage.get('nope')).rejects.toBeInstanceOf(ObjectNotFoundError);
    await storage.put('x', Buffer.from('1'));
    await expect(storage.put('x', Buffer.from('2'), { ifNotExists: true })).rejects.toBeInstanceOf(
      ObjectExistsError,
    );
  });

  it('upload gặp lỗi mạng/timeout → StorageUnavailableError, thông báo KHÔNG lộ chi tiết nội bộ', async () => {
    const { storage, client } = mk();
    client.failWith = Object.assign(
      new Error(`connect ETIMEDOUT 172.20.20.100:9000 key=${SECRET}`),
      { name: 'TimeoutError' },
    );
    const err = await storage.put('x', Buffer.from('1')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageUnavailableError);
    const msg = (err as Error).message;
    expect(msg).not.toMatch(/172\.20|ETIMEDOUT|9000/);
    expect(msg).not.toContain(SECRET);
    // chi tiết vẫn giữ ở `cause` để log nội bộ
    expect(((err as StorageUnavailableError).cause as Error).message).toContain('ETIMEDOUT');
  });

  it('get/stat/list/delete lỗi hạ tầng → StorageUnavailableError (không nuốt)', async () => {
    const { storage, client } = mk();
    client.failWith = awsError('InternalError', 500);
    await expect(storage.get('x')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.stat('x')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.list('x/')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(storage.delete('x')).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});

describe('S3Storage.check — HeadBucket lúc khởi động', () => {
  it('bucket có → ok', async () => {
    const { storage } = mk();
    expect(await storage.check()).toEqual({ ok: true });
  });

  it('bucket thiếu → báo rõ, nhắc tạo thủ công, KHÔNG gọi CreateBucket', async () => {
    const client = new FakeS3Client();
    client.buckets.clear();
    const { storage } = mk(client);
    const r = await storage.check();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/bucket-test/);
    expect(r.detail).toMatch(/tạo/i);
    expect(client.calls.map((c) => c.command)).toEqual(['HeadBucketCommand']);
  });

  it('sai quyền (403) → báo rõ và không lộ khoá', async () => {
    const client = new FakeS3Client();
    client.forbiddenBuckets.add('bucket-test');
    const r = await mk(client).storage.check();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/quyền/i);
    expect(r.detail).not.toContain(SECRET);
  });

  it('không tới được endpoint → báo rõ, không ném', async () => {
    const client = new FakeS3Client();
    client.failWith = Object.assign(new Error(`getaddrinfo ENOTFOUND h ${SECRET}`), {
      name: 'Error',
    });
    const r = await mk(client).storage.check();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/kết nối|endpoint/i);
    expect(r.detail).not.toContain(SECRET);
  });
});

describe('S3Storage — phân loại lỗi HeadBucket (kind) và các lỗi khác', () => {
  const kindOf = async (err: Error) => {
    const client = new FakeS3Client();
    client.failWith = err;
    return mk(client).storage.check();
  };

  it('bucket thiếu / 403 / khoá sai → kind=config (lỗi cấu hình dứt khoát)', async () => {
    expect((await kindOf(awsError('NotFound', 404))).kind).toBe('config');
    expect((await kindOf(awsError('NoSuchBucket', 404))).kind).toBe('config');
    expect((await kindOf(awsError('Forbidden', 403))).kind).toBe('config');
    expect((await kindOf(awsError('AccessDenied', 403))).kind).toBe('config');
    expect((await kindOf(awsError('InvalidAccessKeyId', 403))).kind).toBe('config');
    expect((await kindOf(awsError('SignatureDoesNotMatch', 403))).kind).toBe('config');
  });

  it('mạng/timeout/5xx → kind=network (có thể tự hết)', async () => {
    expect((await kindOf(Object.assign(new Error('x'), { name: 'TimeoutError' }))).kind).toBe(
      'network',
    );
    expect((await kindOf(awsError('InternalError', 500))).kind).toBe('network');
    expect((await kindOf(Object.assign(new Error('ECONNREFUSED'), { name: 'Error' }))).kind).toBe(
      'network',
    );
  });

  it('ok → không có kind', async () => {
    expect(await mk().storage.check()).toEqual({ ok: true });
  });

  it('M9: gợi ý cổng không khẳng định 9000; nhắc dùng HeadBucket để xác định cổng API', async () => {
    const r = await kindOf(Object.assign(new Error('x'), { name: 'TimeoutError' }));
    expect(r.detail).not.toMatch(/thường cổng 9000/);
    expect(r.detail).toMatch(/cổng API/);
  });

  it('M1: NoSuchBucket khi get KHÔNG bị coi là "không có tệp" (404 im lặng) mà là lỗi hạ tầng', async () => {
    const { storage, client } = mk();
    client.failWith = awsError('NoSuchBucket', 404);
    await expect(storage.get('x')).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('M7: destroy() huỷ client S3', () => {
    const { storage, client } = mk();
    storage.destroy();
    expect(client.destroyed).toBe(true);
  });
});
