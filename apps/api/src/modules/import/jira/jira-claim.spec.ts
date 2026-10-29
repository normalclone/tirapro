import { describe, expect, it, vi } from 'vitest';
import { claimImportJob, findImportJobByAnalyzeId } from './jira-claim';

function fake() {
  const jobs: { id: string; workspaceId: string; config: { analyzeId: string } }[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const order: string[] = [];
  let n = 0;
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => {
      order.push(`lock:${strings.join('?')}:${String(vals[0])}`);
      return Promise.resolve(1);
    }),
    importJob: {
      findFirst: vi.fn((a: { where: { workspaceId: string; config: { equals: string } } }) => {
        order.push('find');
        return Promise.resolve(
          jobs.find(
            (j) =>
              j.workspaceId === a.where.workspaceId && j.config.analyzeId === a.where.config.equals,
          ) ?? null,
        );
      }),
      create: vi.fn(async (a: { data: { workspaceId: string; config: { analyzeId: string } } }) => {
        order.push('create');
        await new Promise((r) => setTimeout(r, 5)); // cho các request khác có cơ hội chen vào nếu KHÔNG có khoá
        const j = { id: `job${++n}`, ...a.data };
        jobs.push(j);
        return { id: j.id };
      }),
    },
  };
  const prisma = {
    // mô phỏng khoá advisory: các transaction chạy lần lượt
    $transaction: vi.fn((cb: (t: typeof tx) => Promise<unknown>) => {
      const run = chain.then(() => cb(tx));
      chain = run.catch(() => undefined);
      return run;
    }),
  };
  return { prisma, tx, jobs, order };
}

const data = (analyzeId: string) =>
  ({ workspaceId: 'w1', source: 'JIRA_CLOUD', config: { analyzeId } }) as never;

describe('claimImportJob — claim ở DB', () => {
  it('lấy advisory lock theo analyzeId TRƯỚC khi tìm/tạo, cùng một transaction', async () => {
    const { prisma, order } = fake();
    const r = await claimImportJob(prisma as never, 'w1', 'AN1', data('AN1'));
    expect(r).toEqual({ id: 'job1', created: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order[0]).toMatch(/^lock:.*pg_advisory_xact_lock.*:AN1$/);
    expect(order.slice(1)).toEqual(['find', 'create']);
  });

  it('đã có job cùng analyzeId trong workspace → trả job đó, KHÔNG tạo mới', async () => {
    const { prisma, tx } = fake();
    await claimImportJob(prisma as never, 'w1', 'AN1', data('AN1'));
    const again = await claimImportJob(prisma as never, 'w1', 'AN1', data('AN1'));
    expect(again).toEqual({ id: 'job1', created: false });
    expect(tx.importJob.create).toHaveBeenCalledTimes(1);
  });

  it('20 claim song song cùng analyzeId → đúng 1 job được tạo, mọi bên nhận cùng id', async () => {
    const { prisma, tx } = fake();
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => claimImportJob(prisma as never, 'w1', 'AN1', data('AN1'))),
    );
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    expect(tx.importJob.create).toHaveBeenCalledTimes(1);
  });

  it('analyzeId khác nhau không chặn nhau', async () => {
    const { prisma } = fake();
    const [a, b] = await Promise.all([
      claimImportJob(prisma as never, 'w1', 'AN1', data('AN1')),
      claimImportJob(prisma as never, 'w1', 'AN2', data('AN2')),
    ]);
    expect(a.created && b.created).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it('findImportJobByAnalyzeId lọc theo workspace + nguồn Jira', async () => {
    const { tx } = fake();
    await findImportJobByAnalyzeId(tx as never, 'w1', 'AN1');
    expect(tx.importJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'w1', source: 'JIRA_CLOUD' }) as unknown,
      }),
    );
  });
});
