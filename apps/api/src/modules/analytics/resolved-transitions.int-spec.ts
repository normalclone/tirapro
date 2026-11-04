import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { DigestsService } from '../digests/digests.service';
import { AnalyticsService } from './analytics.service';

/**
 * "Việc vừa xong" CHỈ ĐẾM chuyển VÀO nhóm DONE — trên Postgres thật (OPT-IN, `PARITY_DATABASE_URL=…_scratch`
 * `pnpm --filter @tirapro/api test:parity`). Dòng lịch sử DONE → DONE (do migrate/đổi quy trình ghi) không được làm
 * "đã giải quyết theo ngày" (created-vs-resolved) và bản tin tuần phồng lên.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `rs${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS = id('ws');

describe.skipIf(!DB_URL)('đếm việc vừa xong ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await prisma.user.create({
      data: { id: id('u'), email: `${id('u')}@rs.test`, displayName: 'QT' },
    });
    await prisma.organization.create({ data: { id: WS, name: WS, slug: WS, ownerId: id('u') } });
    await prisma.workflow.create({ data: { id: id('wf'), organizationId: WS, name: 'W' } });
    await prisma.status.createMany({
      data: [
        { id: id('s-todo'), workflowId: id('wf'), name: 'To Do', category: 'TODO', order: 0 },
        {
          id: id('s-doing'),
          workflowId: id('wf'),
          name: 'Doing',
          category: 'IN_PROGRESS',
          order: 1,
        },
        { id: id('s-done'), workflowId: id('wf'), name: 'Done', category: 'DONE', order: 2 },
      ],
    });
    await prisma.issueType.create({
      data: { id: id('t'), organizationId: WS, name: 'Task', key: 'TASK' },
    });
    await prisma.project.create({
      data: { id: id('p'), organizationId: WS, key: 'RS', name: 'RS', defaultWorkflowId: id('wf') },
    });
    const issue = (n: string, status: string) =>
      prisma.issue.create({
        data: {
          id: id(n),
          key: `RS-${n}`,
          number: Math.floor(Math.random() * 1e6),
          organizationId: WS,
          projectId: id('p'),
          typeId: id('t'),
          statusId: id(status),
          summary: n,
          rank: `0|${n}:`,
        },
      });
    for (const n of ['a', 'b', 'c', 'd']) await issue(n, 's-done');
    const now = new Date();
    const hist = (
      n: string,
      oldCategory: 'TODO' | 'IN_PROGRESS' | 'DONE' | null,
      newCategory: 'TODO' | 'IN_PROGRESS' | 'DONE',
    ) =>
      prisma.issueHistory.create({
        data: {
          issueId: id(n),
          projectId: id('p'),
          field: 'STATUS',
          oldCategory,
          newCategory,
          actorId: id('u'),
          occurredAt: now,
        },
      });
    await hist('a', 'TODO', 'DONE'); // xong thật
    await hist('b', 'DONE', 'DONE'); // dòng kiểu migrate: Hoàn thành → Done, KHÔNG phải vừa xong
    await hist('c', 'IN_PROGRESS', 'DONE'); // xong thật
    await hist('d', null, 'DONE'); // tạo thẳng ở DONE (oldCategory null) vẫn tính
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { organizationId: WS } });
    await prisma.organization.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.$disconnect();
  }, 60_000);

  it('created-vs-resolved: "đã giải quyết" theo ngày bỏ dòng DONE → DONE', async () => {
    const svc = new AnalyticsService(prisma as unknown as PrismaService, {} as never, {} as never);
    const report = await svc.createdResolved(WS, id('p'), today, today);
    expect(report.series).toEqual([expect.objectContaining({ date: today, resolved: 3 })]);
  });

  it('bản tin tuần: số việc vừa xong đếm riêng từng việc, bỏ dòng DONE → DONE', async () => {
    const svc = new DigestsService(
      prisma as unknown as PrismaService,
      ...(Array.from({ length: 8 }, () => ({})) as [
        never,
        never,
        never,
        never,
        never,
        never,
        never,
        never,
      ]),
    );
    const since = new Date(Date.now() - 7 * 86_400_000);
    const count = await (
      svc as unknown as {
        countResolved(ctx: { issueScope: unknown }, since: Date): Promise<number>;
      }
    ).countResolved({ issueScope: { organizationId: WS } }, since);
    expect(count).toBe(3);
  });
});
