import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SystemSettingsService } from '../../modules/system-settings/system-settings.service';
import { assertLocalS3Endpoint } from './local-endpoint-guard.testutil';
import { MemoryStorage } from './memory-storage.testutil';
import { migrateObjects } from './migrate-local-to-s3';
import { runObjectStorageContract } from './object-storage.contract.testutil';
import { S3Storage } from './s3-storage';
import { StorageHealthService } from './storage-health.service';

/**
 * DÙNG CHUNG BUCKET: tiền tố `tirapro/` — OPT-IN (MinIO cục bộ, xem đầu `s3-storage.int-spec.ts` cách chạy).
 * Bucket thử có sẵn object của "app khác" NGOÀI tiền tố; sau chu trình put/get/delete/list/migrate/probe/cờ hệ thống/claim,
 * các object đó phải NGUYÊN VẸN (nội dung + ETag) và mọi object mới đều nằm dưới `tirapro/`.
 */
const ENDPOINT = process.env.S3_IT_ENDPOINT ?? 'http://127.0.0.1:9100';
const USER = process.env.MINIO_ROOT_USER;
const PASS = process.env.MINIO_ROOT_PASSWORD;
const ENABLED = !!USER && !!PASS;
if (ENABLED) assertLocalS3Endpoint(ENDPOINT);

const BUCKET = `tirapro-it-${randomBytes(4).toString('hex')}`;
const PREFIX = 'tirapro/';
const FOREIGN: Record<string, string> = {
  'runner/job-1.json': '{"app":"runner"}',
  'boctach/report.pdf': 'pdf của boctach',
  'telegram/state.json': '{"chat":1}',
  'root.txt': 'tệp gốc bucket',
  'tirapro-other/y.txt': 'gần giống tiền tố nhưng là của app khác',
  'ws1/a.txt': 'cùng tên storageKey nhưng NGOÀI tiền tố',
};

describe.skipIf(!ENABLED)('S3Storage + S3_KEY_PREFIX ↔ MinIO thật (bucket dùng chung)', () => {
  const admin = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: USER ?? '', secretAccessKey: PASS ?? '' },
  });
  const storage = () =>
    new S3Storage({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      bucket: BUCKET,
      accessKey: USER ?? '',
      secretKey: PASS ?? '',
      forcePathStyle: true,
      keyPrefix: PREFIX,
    });
  const listAll = async () => {
    const out = await admin.send(new ListObjectsV2Command({ Bucket: BUCKET }));
    return (out.Contents ?? []).map((o) => ({
      key: o.Key ?? '',
      etag: o.ETag ?? '',
      size: o.Size ?? 0,
    }));
  };
  let foreignSnapshot: { key: string; etag: string; size: number }[] = [];

  beforeAll(async () => {
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    for (const [k, v] of Object.entries(FOREIGN))
      await admin.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: Buffer.from(v) }));
    foreignSnapshot = (await listAll()).sort((a, b) => a.key.localeCompare(b.key));
  });

  afterAll(async () => {
    const objs = (await listAll()).map((o) => ({ Key: o.key }));
    if (objs.length)
      await admin.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objs } }));
    await admin.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    admin.destroy();
  });

  const expectForeignIntact = async () => {
    const now = await listAll();
    const foreignNow = now
      .filter((o) => !o.key.startsWith(PREFIX))
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(foreignNow).toEqual(foreignSnapshot); // cùng khoá, ETag, kích thước
    expect(now.filter((o) => o.key.startsWith(PREFIX) === false).length).toBe(
      foreignSnapshot.length,
    );
  };

  runObjectStorageContract(
    'S3Storage + MinIO thật + tiền tố tirapro/',
    () => Promise.resolve({ storage: storage(), cleanup: () => Promise.resolve() }),
    'it-prefix',
  );

  it('put/get/delete cùng storageKey với object ngoài tiền tố: bản ngoài không bị đọc/ghi/xoá', async () => {
    const s = storage();
    await s.put('ws1/a.txt', Buffer.from('của Tirapro'));
    expect((await listAll()).map((o) => o.key)).toContain('tirapro/ws1/a.txt');
    await s.delete('ws1/a.txt');
    expect(await s.exists('ws1/a.txt')).toBe(false);
    await expectForeignIntact();
  });

  it('khoá thoát tiền tố bị chặn trước khi gửi: không xoá/đọc được object của app khác', async () => {
    const s = storage();
    for (const bad of ['../runner/job-1.json', 'a/../../root.txt', '/root.txt'])
      await expect(s.delete(bad)).rejects.toThrow(/khoá/i);
    await expect(s.get('../runner/job-1.json')).rejects.toThrow(/khoá/i);
    await expectForeignIntact();
  });

  it('list: chỉ thấy object trong tiền tố, khoá trả về đã cắt tiền tố; list rỗng không lộ object app khác', async () => {
    const s = storage();
    await s.put('imports/a.csv', Buffer.from('1'));
    const all = await s.list('');
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) expect(Object.keys(FOREIGN)).not.toContain(o.key);
    expect((await s.list('imports/')).map((o) => o.key)).toEqual(['imports/a.csv']);
    await s.delete('imports/a.csv');
    await expectForeignIntact();
  });

  it('chu trình migrate local→S3 (kể cả system-settings.json): khoá đích có tiền tố, DB-key không tiền tố, app khác nguyên vẹn', async () => {
    const local = new MemoryStorage();
    await local.put('ws9/aaa-x.pdf', Buffer.from('PDF'));
    await local.put('avatars/user-1.png', Buffer.from('PNG'));
    await local.put('system-settings.json', Buffer.from('{"signupEnabled":false}'));
    const keys = ['ws9/aaa-x.pdf', 'avatars/user-1.png', 'system-settings.json'];
    const s = storage();
    const dry = await migrateObjects({ source: local, dest: s, keys, dryRun: true });
    expect(dry.copied).toBe(3);
    expect((await listAll()).some((o) => o.key === 'tirapro/ws9/aaa-x.pdf')).toBe(false); // dry-run không ghi
    const real = await migrateObjects({ source: local, dest: s, keys, dryRun: false });
    expect(real).toMatchObject({ copied: 3, failed: 0, conflicts: 0 });
    const keysNow = (await listAll()).map((o) => o.key);
    for (const k of keys) expect(keysNow).toContain(`${PREFIX}${k}`);
    const again = await migrateObjects({ source: local, dest: s, keys, dryRun: false });
    expect(again).toMatchObject({ copied: 0, skipped: 3 });
    for (const k of keys) await s.delete(k);
    await expectForeignIntact();
  });

  it('khởi động (HeadBucket + probe ghi có điều kiện), cờ hệ thống và claim Jira đều nằm trong tiền tố', async () => {
    const s = storage();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const health = new StorageHealthService(s, { get: () => true } as never);
    await health.onModuleInit();
    err.mockRestore();
    const settings = new SystemSettingsService(s);
    await settings.onModuleInit();
    await settings.setFlags({ maintenanceBanner: 'thử tiền tố' });
    settings.onModuleDestroy();
    await s.put('imports/zzz.claimed', Buffer.from('{}'), { ifNotExists: true });
    const keysNow = (await listAll()).map((o) => o.key);
    expect(keysNow).toContain('tirapro/system-settings.json');
    expect(keysNow).toContain('tirapro/imports/zzz.claimed');
    expect(keysNow.filter((k) => k.includes('.probe/'))).toEqual([]); // probe đã dọn
    for (const k of keysNow)
      if (!Object.keys(FOREIGN).includes(k)) expect(k.startsWith(PREFIX), k).toBe(true);
    await s.delete('system-settings.json');
    await s.delete('imports/zzz.claimed');
    await expectForeignIntact();
  });

  it('dọn theo tiền tố rồi: chỉ còn đúng các object của app khác', async () => {
    const s = storage();
    for (const o of await s.list('')) await s.delete(o.key); // dọn phần của hợp đồng chung
    const left = (await listAll()).map((o) => o.key).sort();
    expect(left).toEqual(Object.keys(FOREIGN).sort());
  });
});
