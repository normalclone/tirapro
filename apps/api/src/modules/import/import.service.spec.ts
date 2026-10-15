import { describe, expect, it, vi } from 'vitest';
import { ImportService } from './import.service';

function setup(failSummary?: string) {
  const tx = {};
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    importJob: {
      create: vi.fn(() => Promise.resolve({ id: 'job1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve([{ id: 't1', name: 'Task' }])) },
    priority: { findMany: vi.fn(() => Promise.resolve([])) },
  };
  const issues = {
    createWithin: vi.fn(
      async (_tx: unknown, _w: string, _u: string, input: { summary: string }) => {
        await Promise.resolve();
        if (input.summary === failSummary) throw new Error('lỗi DB giả lập');
        return { id: `id-${input.summary}` };
      },
    ),
    emitCreated: vi.fn(),
  };
  const service = new ImportService(prisma as never, issues as never);
  return { service, prisma, issues };
}

const csvOf = (n: number) =>
  ['summary', ...Array.from({ length: n }, (_, i) => `row${i}`)].join('\n');

describe('ImportService — ghi theo lô', () => {
  it('250 dòng => 3 transaction (100/100/50), sự kiện phát sau commit cho từng issue', async () => {
    const { service, prisma, issues } = setup();
    const res = await service.importCsv('w1', 'u1', { projectId: 'p1', csv: csvOf(250) });
    expect(res).toMatchObject({ created: 250, failed: 0, total: 250 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(issues.createWithin).toHaveBeenCalledTimes(250);
    expect(issues.emitCreated).toHaveBeenCalledTimes(250);
  });

  it('một dòng lỗi => lô đó rollback, chạy lại từng dòng, chỉ dòng lỗi bị báo; không emit cho dòng đã rollback', async () => {
    const { service, prisma, issues } = setup('row150');
    const res = await service.importCsv('w1', 'u1', { projectId: 'p1', csv: csvOf(250) });
    expect(res.created).toBe(249);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual([{ row: 150, error: 'lỗi DB giả lập' }]);
    // lô 1 + lô 2 (lỗi) + 100 lần chạy lại từng dòng + lô 3
    expect(prisma.$transaction).toHaveBeenCalledTimes(103);
    expect(issues.emitCreated).toHaveBeenCalledTimes(249);
  });
});
