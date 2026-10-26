import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../../common/testing/parity-db-guard';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import { claimImportJob } from './jira-claim';

/**
 * ĐUA CLAIM IMPORT JIRA TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch pnpm --filter @tirapro/api test:parity`).
 * Kiểm `pg_advisory_xact_lock` + tìm/tạo trong một transaction: nhiều request song song cùng analyzeId chỉ tạo ĐÚNG MỘT ImportJob.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `jclaim${Date.now().toString(36)}`;
const WS = `${TAG}-ws`;
const USER = `${TAG}-u`;

describe.skipIf(!DB_URL)('claimImportJob ↔ Postgres thật', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await prisma.user.create({
      data: { id: USER, email: `${USER}@claim.test`, displayName: 'Claim' },
    });
    await prisma.workspace.create({ data: { id: WS, name: TAG, slug: TAG, ownerId: USER } });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.importJob.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.$disconnect();
  }, 60_000);

  const data = (analyzeId: string) => ({
    workspaceId: WS,
    source: 'JIRA_CLOUD' as const,
    status: 'RUNNING' as const,
    createdById: USER,
    config: { format: 'jira-csv', analyzeId },
  });

  it('30 claim song song cùng analyzeId → đúng 1 ImportJob, mọi bên nhận cùng id', async () => {
    const db = prisma as unknown as PrismaService;
    const rs = await Promise.all(
      Array.from({ length: 30 }, () => claimImportJob(db, WS, 'AN-RACE', data('AN-RACE'))),
    );
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(await prisma.importJob.count({ where: { workspaceId: WS } })).toBe(1);
  });

  it('claim lại sau khi job đã COMPLETED vẫn trả job cũ (không tạo mới)', async () => {
    const db = prisma as unknown as PrismaService;
    const first = await claimImportJob(db, WS, 'AN-DONE', data('AN-DONE'));
    await prisma.importJob.update({ where: { id: first.id }, data: { status: 'COMPLETED' } });
    const again = await claimImportJob(db, WS, 'AN-DONE', data('AN-DONE'));
    expect(again).toEqual({ id: first.id, created: false });
  });

  it('analyzeId khác nhau → job khác nhau', async () => {
    const db = prisma as unknown as PrismaService;
    const [a, b] = await Promise.all([
      claimImportJob(db, WS, 'AN-X', data('AN-X')),
      claimImportJob(db, WS, 'AN-Y', data('AN-Y')),
    ]);
    expect(a.id).not.toBe(b.id);
  });
});
