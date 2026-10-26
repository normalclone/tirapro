import { describe, expect, it } from 'vitest';
import { FakeS3Client, awsError } from './fake-s3-client.testutil';
import { runObjectStorageContract } from './object-storage.contract.testutil';
import { ObjectExistsError, ObjectNotFoundError, StorageUnavailableError } from './object-storage';
import { S3Storage } from './s3-storage';

const SECRET = 'SUPER-SECRET-KEY-do-not-leak';
const mk = (client = new FakeS3Client(), keyPrefix?: string) => ({
  client,
  storage: new S3Storage(
    {
      endpoint: 'http://127.0.0.1:9100',
      region: 'us-east-1',
      bucket: 'bucket-test',
      accessKey: 'AK',
      secretKey: SECRET,
      forcePathStyle: true,
      keyPrefix,
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

  it('N1: có phản hồi HTTP nhưng không phải lỗi S3 quen thuộc (name Unknown + 200/400, vd cổng console trả HTML) → config, gợi ý sai cổng', async () => {
    for (const st of [200, 400, 301, 401, 418]) {
      const r = await kindOf(awsError('Unknown', st));
      expect(r.kind, `status ${st}`).toBe('config');
      expect(r.detail).toMatch(/sai cổng S3 API/);
      expect(r.detail).toMatch(/9000 là console, 9001 là API/);
      expect(r.detail).toMatch(/không phải S3/);
    }
  });

  it('N1: chỉ coi là network khi KHÔNG có phản hồi HTTP, hoặc 5xx/429/408', async () => {
    for (const st of [500, 502, 503, 504, 429, 408]) {
      expect((await kindOf(awsError('Whatever', st))).kind, `status ${st}`).toBe('network');
    }
    const noResp = await kindOf(
      Object.assign(new Error('getaddrinfo ENOTFOUND h'), { name: 'Error' }),
    );
    expect(noResp.kind).toBe('network');
    expect((await kindOf(Object.assign(new Error('x'), { name: 'TimeoutError' }))).kind).toBe(
      'network',
    );
  });

  it('N4: RequestTimeTooSkewed (403) → config với thông báo LỆCH GIỜ riêng, không nói "sai khoá"', async () => {
    const r = await kindOf(awsError('RequestTimeTooSkewed', 403));
    expect(r.kind).toBe('config');
    expect(r.detail).toMatch(/Đồng hồ máy chủ lệch với S3/);
    expect(r.detail).toMatch(/NTP/);
    expect(r.detail).not.toMatch(/sai khoá/);
  });

  it('N4: 403 chung (HEAD không có body nên không thấy mã lỗi) vẫn gợi ý kiểm tra lệch giờ NTP', async () => {
    const r = await kindOf(awsError('Forbidden', 403));
    expect(r.kind).toBe('config');
    expect(r.detail).toMatch(/NTP/);
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

describe('S3Storage — S3_KEY_PREFIX (dùng chung bucket, chỉ thao tác trong tiền tố)', () => {
  const PREFIX = 'tirapro/';
  const FOREIGN = [
    'bucket-test/runner/job-1.json',
    'bucket-test/boctach/report.pdf',
    'bucket-test/root.txt',
    'bucket-test/tirapro-other/x.txt', // gần giống tiền tố nhưng KHÔNG thuộc tiền tố
  ];
  const withForeign = () => {
    const client = new FakeS3Client();
    for (const k of FOREIGN)
      client.objects.set(k, { body: Buffer.from('của app khác'), lastModified: new Date(0) });
    return { client, storage: mk(client, PREFIX).storage };
  };
  const foreignIntact = (client: FakeS3Client) => {
    for (const k of FOREIGN) expect(client.objects.get(k)?.body.toString(), k).toBe('của app khác');
  };

  runObjectStorageContract(
    'S3Storage + client giả + tiền tố',
    () => Promise.resolve({ storage: withForeign().storage, cleanup: () => Promise.resolve() }),
    'contract-prefix',
  );

  it('mọi lệnh gửi lên S3 có Key = tiền tố + storageKey (kể cả put/get/stat/exists/delete)', async () => {
    const { client, storage } = withForeign();
    await storage.put('ws1/a.txt', Buffer.from('1'), { contentType: 'text/plain' });
    await storage.get('ws1/a.txt');
    await storage.stat('ws1/a.txt');
    await storage.exists('ws1/a.txt');
    await storage.delete('ws1/a.txt');
    const keyed = client.calls.filter((c) => typeof c.input.Key === 'string');
    expect(keyed.length).toBe(5);
    for (const c of keyed) expect(c.input.Key, c.command).toBe('tirapro/ws1/a.txt');
  });

  it('object lưu thật nằm dưới tiền tố, còn storageKey trả về cho DB KHÔNG có tiền tố', async () => {
    const { client, storage } = withForeign();
    const r = await storage.put('ws1/a.txt', Buffer.from('1'));
    expect(r.key).toBe('ws1/a.txt');
    expect(client.objects.has('bucket-test/tirapro/ws1/a.txt')).toBe(true);
    expect(client.objects.has('bucket-test/ws1/a.txt')).toBe(false);
  });

  it('get/delete/stat KHÔNG BAO GIỜ chạm khoá không có tiền tố: cùng tên với object ngoài tiền tố vẫn nguyên', async () => {
    const { client, storage } = withForeign();
    client.objects.set('bucket-test/ws1/a.txt', {
      body: Buffer.from('ngoài'),
      lastModified: new Date(0),
    });
    await expect(storage.get('ws1/a.txt')).rejects.toThrow(); // chỉ có bản ngoài tiền tố → coi như không có
    expect(await storage.exists('ws1/a.txt')).toBe(false);
    await storage.delete('ws1/a.txt');
    expect(client.objects.get('bucket-test/ws1/a.txt')?.body.toString()).toBe('ngoài');
    foreignIntact(client);
    for (const c of client.calls)
      if (typeof c.input.Key === 'string') expect(c.input.Key).toMatch(/^tirapro\//);
  });

  it('từ chối khoá thoát khỏi tiền tố: "..", tuyệt đối, "./" — và không gửi lệnh nào lên S3', async () => {
    const { client, storage } = withForeign();
    for (const bad of [
      '../runner/job-1.json',
      'a/../../runner/job-1.json',
      '/runner/job-1.json',
      './x',
      'a/./b',
    ]) {
      await expect(storage.get(bad)).rejects.toThrow(/khoá/i);
      await expect(storage.delete(bad)).rejects.toThrow(/khoá/i);
      await expect(storage.put(bad, Buffer.from('x'))).rejects.toThrow(/khoá/i);
      await expect(storage.stat(bad)).rejects.toThrow(/khoá/i);
    }
    expect(client.calls).toEqual([]);
    foreignIntact(client);
  });

  it('list luôn có Prefix (kể cả prefix rỗng), chỉ trả object trong tiền tố và cắt tiền tố khỏi khoá trả về', async () => {
    const { client, storage } = withForeign();
    await storage.put('imports/a.csv', Buffer.from('1'));
    await storage.put('ws/b.txt', Buffer.from('22'));
    const imports = await storage.list('imports/');
    expect(imports.map((o) => o.key)).toEqual(['imports/a.csv']);
    const all = await storage.list('');
    expect(all.map((o) => o.key).sort()).toEqual(['imports/a.csv', 'ws/b.txt']);
    for (const c of client.calls.filter((x) => x.command === 'ListObjectsV2Command')) {
      expect(String(c.input.Prefix)).toMatch(/^tirapro\//);
    }
  });

  it('khoá bí mật/tiền tố: storage.keyPrefix hiển thị được, không có khoá', () => {
    expect(mk(new FakeS3Client(), PREFIX).storage.keyPrefix).toBe(PREFIX);
  });

  it('cấu hình tiền tố sai (thoát bucket) → ném ngay khi dựng S3Storage', () => {
    for (const bad of ['../x', '/x', 'a\\b'])
      expect(() => mk(new FakeS3Client(), bad)).toThrow(/S3_KEY_PREFIX/);
  });

  it('tiền tố không có "/" cuối được chuẩn hoá (tirapro → tirapro/)', async () => {
    const client = new FakeS3Client();
    const s = mk(client, 'tirapro').storage;
    await s.put('k.txt', Buffer.from('1'));
    expect(client.calls[0]?.input.Key).toBe('tirapro/k.txt');
  });

  it('không tiền tố (mặc định): khoá giữ nguyên như trước', async () => {
    const client = new FakeS3Client();
    await mk(client).storage.put('ws1/a.txt', Buffer.from('1'));
    expect(client.calls[0]?.input.Key).toBe('ws1/a.txt');
  });
});
