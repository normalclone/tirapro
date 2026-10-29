/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung DB/bucket/thư mục tạm */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalS3Endpoint } from './common/storage/local-endpoint-guard.testutil';
import { assertParityDatabase } from './common/testing/parity-db-guard';

/**
 * SMOKE: CHẠY THẬT các script vận hành (`node scripts/*.mjs`) — OPT-IN (vitest.int.config.ts).
 * Cần: `pnpm --filter @tirapro/api build` (script dùng `dist/`), DB nháp (PARITY_DATABASE_URL, đuôi _scratch/_parity/_w2c, đã
 * migrate deploy) và MinIO cục bộ (creds ở env MINIO_ROOT_USER/PASSWORD). Spawn tiến trình con, kiểm mã thoát + dòng kết quả.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
const ENDPOINT = process.env.S3_IT_ENDPOINT ?? 'http://127.0.0.1:9100';
const USER = process.env.MINIO_ROOT_USER;
const PASS = process.env.MINIO_ROOT_PASSWORD;
const ENABLED = !!DB_URL && !!USER && !!PASS;
if (ENABLED) {
  assertParityDatabase(DB_URL);
  assertLocalS3Endpoint(ENDPOINT);
}

const API_DIR = join(__dirname, '..');
const SCRIPTS = join(API_DIR, 'scripts');
const TAG = `smk${randomBytes(3).toString('hex')}`;
const BUCKET = `tirapro-it-${TAG}`;

describe.skipIf(!ENABLED)('scripts vận hành chạy thật (spawn)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
  const admin = new S3Client({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: USER ?? '', secretAccessKey: PASS ?? '' },
  });
  let localDir = '';
  const ids = { user: `${TAG}-u`, ws: `${TAG}-w` };
  const mangled = Buffer.from('báo cáo tháng 10.pdf', 'utf8').toString('latin1');

  const run = (script: string, args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
      cwd: API_DIR,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? '',
        DATABASE_URL: DB_URL!,
        STORAGE_LOCAL_DIR: localDir,
        S3_ENDPOINT: ENDPOINT,
        S3_BUCKET: BUCKET,
        S3_ACCESS_KEY: USER ?? '',
        S3_SECRET_KEY: PASS ?? '',
        ...extra,
      },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const bucketKeys = async () =>
    ((await admin.send(new ListObjectsV2Command({ Bucket: BUCKET }))).Contents ?? []).map(
      (o) => o.Key ?? '',
    );
  const bodyOf = async (key: string) =>
    (
      await admin.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    ).Body?.transformToString();

  beforeAll(async () => {
    expect(
      existsSync(join(API_DIR, 'dist', 'common', 'storage', 's3-storage.js')),
      'cần `pnpm --filter @tirapro/api build` trước',
    ).toBe(true);
    localDir = mkdtempSync(join(tmpdir(), 'tirapro-smoke-'));
    mkdirSync(join(localDir, ids.ws), { recursive: true });
    writeFileSync(join(localDir, ids.ws, 'aaa-x.pdf'), 'PDFDATA');
    writeFileSync(join(localDir, 'system-settings.json'), '{"signupEnabled":true}');
    await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));
    await admin.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: 'runner/job-1.json',
        Body: Buffer.from('app khác'),
      }),
    );
    await prisma.user.create({
      data: { id: ids.user, email: `${ids.user}@smoke.test`, displayName: 'Smoke' },
    });
    await prisma.workspace.create({
      data: { id: ids.ws, name: TAG, slug: TAG, ownerId: ids.user },
    });
    await prisma.attachment.createMany({
      data: [
        {
          id: `${TAG}-a1`,
          fileName: mangled,
          mimeType: 'application/pdf',
          sizeBytes: 7,
          storageKey: `${ids.ws}/aaa-x.pdf`,
        },
        {
          id: `${TAG}-a2`,
          fileName: 'cafe.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          storageKey: `${ids.ws}/bbb-y.txt`,
        },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.workspace.deleteMany({ where: { id: ids.ws } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
    const objs = (await bucketKeys()).map((Key) => ({ Key }));
    if (objs.length)
      await admin.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objs } }));
    await admin.send(new DeleteBucketCommand({ Bucket: BUCKET }));
    admin.destroy();
    if (localDir) rmSync(localDir, { recursive: true, force: true });
  }, 60_000);

  it('storage:migrate-local-to-s3 --dry-run (không tiền tố): thoát 0, in kết quả, KHÔNG ghi', async () => {
    const r = run('storage-migrate-local-to-s3.mjs', ['--dry-run']);
    expect(r.out).not.toMatch(/TypeError|Cannot read properties|ReferenceError/);
    expect(r.code).toBe(0);
    expect(r.out).toContain('[DRY-RUN]');
    expect(r.out).toContain(`[copy] ${ids.ws}/aaa-x.pdf → s3://${BUCKET}/${ids.ws}/aaa-x.pdf`);
    expect(r.out).toMatch(/Kết quả \(dry-run — chưa ghi gì\): sẽ chép 2, .*lỗi 0\./);
    expect(await bucketKeys()).toEqual(['runner/job-1.json']);
  });

  it('storage:migrate-local-to-s3 --dry-run (S3_KEY_PREFIX=tirapro): khoá đích có tiền tố', async () => {
    const r = run('storage-migrate-local-to-s3.mjs', ['--dry-run'], { S3_KEY_PREFIX: 'tirapro' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('(tiền tố "tirapro/")');
    expect(r.out).toContain(`→ s3://${BUCKET}/tirapro/${ids.ws}/aaa-x.pdf`);
    expect(await bucketKeys()).toEqual(['runner/job-1.json']);
  });

  it('storage:migrate-local-to-s3 thật với tiền tố: chép dưới tiền tố, bỏ qua lần hai, app khác nguyên vẹn', async () => {
    const real = run('storage-migrate-local-to-s3.mjs', [], { S3_KEY_PREFIX: 'tirapro' });
    expect(real.code).toBe(0);
    expect(real.out).toMatch(/đã chép 2, bỏ qua \(đã có cùng kích thước\) 0/);
    expect(await bodyOf(`tirapro/${ids.ws}/aaa-x.pdf`)).toBe('PDFDATA');
    expect(await bodyOf('tirapro/system-settings.json')).toBe('{"signupEnabled":true}');
    expect(await bodyOf('runner/job-1.json')).toBe('app khác');
    expect((await bucketKeys()).filter((k) => !k.startsWith('tirapro/'))).toEqual([
      'runner/job-1.json',
    ]);
    const again = run('storage-migrate-local-to-s3.mjs', [], { S3_KEY_PREFIX: 'tirapro' });
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/đã chép 0, bỏ qua \(đã có cùng kích thước\) 2/);
  });

  it('storage:migrate-local-to-s3: tiền tố sai → thoát 1 với thông báo, không stack trace', () => {
    const r = run('storage-migrate-local-to-s3.mjs', ['--dry-run'], { S3_KEY_PREFIX: '../x' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/S3_KEY_PREFIX không hợp lệ/);
    expect(r.out).not.toMatch(/at .*\.mjs:\d+/);
  });

  it('storage:migrate-local-to-s3: thiếu biến → thoát 1', () => {
    const r = run('storage-migrate-local-to-s3.mjs', ['--dry-run'], { S3_BUCKET: '' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Thiếu biến môi trường: S3_BUCKET/);
  });

  it('attachments:fix-filenames --dry-run: thoát 0, liệt kê tên méo, KHÔNG ghi; chạy thật sửa; lần hai idempotent', async () => {
    const dry = run('attachments-fix-filenames.mjs', ['--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(`[DRY-RUN] ${TAG}-a1: "${mangled}" → "báo cáo tháng 10.pdf"`);
    expect((await prisma.attachment.findUnique({ where: { id: `${TAG}-a1` } }))?.fileName).toBe(
      mangled,
    );
    const real = run('attachments-fix-filenames.mjs', []);
    expect(real.code).toBe(0);
    expect(real.out).toMatch(/đã sửa \d+ tên\./);
    expect((await prisma.attachment.findUnique({ where: { id: `${TAG}-a1` } }))?.fileName).toBe(
      'báo cáo tháng 10.pdf',
    );
    expect((await prisma.attachment.findUnique({ where: { id: `${TAG}-a2` } }))?.fileName).toBe(
      'cafe.txt',
    );
    const again = run('attachments-fix-filenames.mjs', []);
    expect(again.code).toBe(0);
    expect(again.out).toContain('đã sửa 0 tên.');
  });

  it('attachments:fix-filenames: thiếu DATABASE_URL → thoát 1', () => {
    const r = run('attachments-fix-filenames.mjs', ['--dry-run'], { DATABASE_URL: '' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Thiếu DATABASE_URL/);
  });
});
