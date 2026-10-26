import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalS3Endpoint } from './local-endpoint-guard.testutil';
import { runObjectStorageContract, readAll } from './object-storage.contract.testutil';
import { StorageUnavailableError } from './object-storage';
import { S3Storage } from './s3-storage';

/**
 * TÍCH HỢP VỚI MINIO THẬT CỤC BỘ — OPT-IN, không chạy trong `pnpm test` (đuôi `.int-spec.ts`, chỉ vitest.int.config.ts nhận).
 *
 *   set -a; . ~/tirapro-data/minio-test/creds.env; set +a      # MINIO_ROOT_USER / MINIO_ROOT_PASSWORD (không in ra, không commit)
 *   pnpm --filter @tirapro/api test:parity
 *
 * Endpoint mặc định http://127.0.0.1:9100 (đổi bằng S3_IT_ENDPOINT nhưng PHẢI là 127.0.0.1/localhost — host khác bị từ chối ngay).
 * Spec tự tạo bucket ngẫu nhiên `tirapro-it-<rand>` và dọn sau. Thiếu thông tin đăng nhập ⇒ bỏ qua.
 */
const ENDPOINT = process.env.S3_IT_ENDPOINT ?? 'http://127.0.0.1:9100';
const USER = process.env.MINIO_ROOT_USER;
const PASS = process.env.MINIO_ROOT_PASSWORD;
const ENABLED = !!USER && !!PASS;
if (ENABLED) assertLocalS3Endpoint(ENDPOINT); // TRƯỚC mọi thao tác mạng

const BUCKET = `tirapro-it-${randomBytes(4).toString('hex')}`;
const cfg = (bucket: string, endpoint = ENDPOINT) => ({
  endpoint,
  region: 'us-east-1',
  bucket,
  accessKey: USER ?? '',
  secretKey: PASS ?? '',
  forcePathStyle: true,
});

describe.skipIf(!ENABLED)('S3Storage ↔ MinIO thật (cục bộ)', () => {
  const admin = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: USER ?? '', secretAccessKey: PASS ?? '' },
  });

  beforeAll(async () => {
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
  });

  afterAll(async () => {
    const list = await admin.send(new ListObjectsV2Command({ Bucket: BUCKET }));
    const objs = (list.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (objs.length)
      await admin.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objs } }));
    await admin.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    admin.destroy();
  });

  runObjectStorageContract(
    'S3Storage + MinIO thật',
    () =>
      Promise.resolve({ storage: new S3Storage(cfg(BUCKET)), cleanup: () => Promise.resolve() }),
    `it-${randomBytes(3).toString('hex')}`,
  );

  it('HeadBucket: bucket có → ok; bucket không có → báo rõ và KHÔNG tự tạo', async () => {
    expect(await new S3Storage(cfg(BUCKET)).check()).toEqual({ ok: true });
    const ghost = `tirapro-it-ghost-${randomBytes(3).toString('hex')}`;
    const r = await new S3Storage(cfg(ghost)).check();
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('config');
    expect(r.detail).toContain(ghost);
    // chắc chắn không bị tạo
    expect((await new S3Storage(cfg(ghost)).check()).ok).toBe(false);
  });

  it('sai khoá → check báo lỗi quyền/đăng nhập, không lộ khoá', async () => {
    const bad = new S3Storage({ ...cfg(BUCKET), secretKey: 'sai-khoa-sai-khoa' });
    const r = await bad.check();
    expect(r.ok).toBe(false);
    expect(r.detail).not.toContain('sai-khoa-sai-khoa');
  });

  it('tệp 6MB + tên khoá có dấu/khoảng trắng vẫn nguyên vẹn', async () => {
    const s = new S3Storage(cfg(BUCKET));
    const body = randomBytes(6 * 1024 * 1024);
    await s.put('w1/big-báo cáo (1).bin', body, { contentType: 'application/octet-stream' });
    const got = await s.get('w1/big-báo cáo (1).bin');
    expect(got.size).toBe(body.length);
    expect((await readAll(got.stream)).equals(body)).toBe(true);
  });

  it('N1: nhầm sang cổng CONSOLE của MinIO (trả HTML) → check() là config + gợi ý sai cổng (không phải network)', async (ctx) => {
    const consoleUrl = process.env.S3_IT_CONSOLE_ENDPOINT ?? 'http://127.0.0.1:9101';
    assertLocalS3Endpoint(consoleUrl);
    const up = await fetch(consoleUrl).then(
      (r) => r.ok,
      () => false,
    );
    if (!up) return ctx.skip(); // máy test không bật console MinIO
    const r = await new S3Storage(cfg(BUCKET, consoleUrl)).check();
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('config');
    expect(r.detail).toMatch(/sai cổng S3 API/);
  });

  it('endpoint không tới được → StorageUnavailableError nhanh, thông báo chung', async () => {
    const s = new S3Storage(cfg(BUCKET, 'http://127.0.0.1:1'));
    const t0 = Date.now();
    const err = await s.put('x', Buffer.from('1')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageUnavailableError);
    expect((err as Error).message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
