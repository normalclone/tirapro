import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from './search.service';

/**
 * F1 TRÊN POSTGRES THẬT — OPT-IN, không chạy trong `pnpm test`: dưới `LOCK TABLE "Issue"` do một kết nối khác giữ, gợi ý nới
 * bộ lọc có `text ~` phải trả "không đếm kịp" (`count: null`) trong ngân sách ~3s (statement_timeout) thay vì treo tới khi khoá
 * nhả. Không nạp dữ liệu nào; khoá nhả ngay khi spec xong.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/projira_w2c?schema=public pnpm --filter @tirapro/api test:parity`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

describe.skipIf(!DB_URL)('gợi ý nới bộ lọc có text ~ dưới khoá bảng ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  let locker: PrismaClient;
  let release: () => void = () => undefined;
  let lockDone: Promise<unknown> = Promise.resolve();

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    locker = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
  }, 60_000);

  afterAll(async () => {
    release();
    await lockDone.catch(() => undefined);
    await prisma?.$disconnect();
    await locker?.$disconnect();
  }, 60_000);

  it('bị chặn bởi khoá bảng → mọi mệnh đề count:null trong < 5.5s, không ném', async () => {
    let locked: () => void = () => undefined;
    const gotLock = new Promise<void>((r) => (locked = r));
    const hold = new Promise<void>((r) => (release = r));
    lockDone = locker.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "Issue" IN ACCESS EXCLUSIVE MODE`;
        locked();
        await hold;
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
    await gotLock;

    const access = {
      visibleWhere: () => Promise.resolve({}),
      visibleProjectIds: () => Promise.resolve(null),
    };
    const service = new SearchService(
      {} as never,
      prisma as unknown as PrismaService,
      access as never,
    );

    const t0 = Date.now();
    const res = await service.relaxCounts('F1WS', 'F1USER', {
      jql: 'text ~ "lỗi" AND text ~ "đăng nhập"',
    });
    const took = Date.now() - t0;

    expect(res.clauses.map((c) => c.count)).toEqual([null, null]);
    expect(res.clauses[0]).toMatchObject({
      text: 'text ~ "lỗi"',
      jqlWithout: 'text ~ "đăng nhập"',
    });
    expect(took).toBeLessThan(5_500);
    release();
    await lockDone;
  }, 30_000);
});
