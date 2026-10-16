import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { QaReportService } from './qa-report.service';

const T = (s: string) => new Date(s);

function make(over: { affects?: unknown[]; fix?: unknown[]; project?: unknown } = {}) {
  const issueFixVersion = {
    findMany: vi.fn((args: { where: { type: string } }) =>
      Promise.resolve(args.where.type === 'AFFECTS' ? (over.affects ?? []) : (over.fix ?? [])),
    ),
  };
  const prisma = {
    project: {
      findFirst: vi.fn((_args: unknown) =>
        Promise.resolve('project' in over ? over.project : { id: 'P1', workspaceId: 'W1' }),
      ),
    },
    issue: {
      groupBy: vi.fn(() =>
        Promise.resolve([
          { severityId: 's1', _count: { _all: 3 } },
          { severityId: null, _count: { _all: 2 } },
        ]),
      ),
      count: vi.fn(() => Promise.resolve(7)),
      findMany: vi.fn(() =>
        Promise.resolve([
          { createdAt: T('2026-10-10T00:00:00Z'), resolvedAt: T('2026-10-10T02:00:00Z') },
          { createdAt: T('2026-10-10T00:00:00Z'), resolvedAt: T('2026-10-10T06:00:00Z') },
        ]),
      ),
    },
    issueHistory: {
      findMany: vi.fn((args: { where: { newCategory: unknown } }) =>
        Promise.resolve(
          args.where.newCategory === 'DONE'
            ? [{ issueId: 'a' }, { issueId: 'b' }, { issueId: 'c' }, { issueId: 'd' }]
            : [{ issueId: 'b' }],
        ),
      ),
    },
    issueFixVersion,
    severity: {
      findMany: vi.fn(() =>
        Promise.resolve([{ id: 's1', name: 'Critical', color: '#f00', rank: 4 }]),
      ),
    },
    version: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'v1', name: '1.0', status: 'RELEASED', releaseDate: T('2026-10-01T00:00:00Z') },
        ]),
      ),
    },
  };
  return { prisma, svc: new QaReportService(prisma as never) };
}

const BUG_TYPE = {
  OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }],
};

describe('QaReportService.report', () => {
  it('dự án không thuộc workspace => 404', async () => {
    const { svc } = make({ project: null });
    await expect(svc.report('W1', 'PX')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('from/to không hợp lệ hoặc đảo ngược => BusinessRuleException', async () => {
    const { svc } = make();
    await expect(svc.report('W1', 'P1', 'abc', undefined)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    await expect(svc.report('W1', 'P1', '2026-10-10', '2026-10-01')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('mọi truy vấn khoá đúng dự án, loại bug, loại bản xoá mềm', async () => {
    const { svc, prisma } = make();
    await svc.report('W1', 'P1', '2026-10-01', '2026-10-15');
    expect(prisma.project.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'P1', workspaceId: 'W1', deletedAt: null },
    });
    for (const fn of [prisma.issue.groupBy, prisma.issue.count, prisma.issue.findMany]) {
      for (const call of fn.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>) {
        expect(call[0].where).toMatchObject({ projectId: 'P1', deletedAt: null, type: BUG_TYPE });
      }
    }
    for (const call of prisma.issueHistory.findMany.mock.calls as unknown as Array<
      [{ where: { projectId: string; field: string; issue: Record<string, unknown> } }]
    >) {
      expect(call[0].where).toMatchObject({
        projectId: 'P1',
        field: 'STATUS',
        issue: { deletedAt: null, type: BUG_TYPE },
      });
    }
    for (const call of prisma.issueFixVersion.findMany.mock.calls as unknown as Array<
      [{ where: { version: unknown; issue: unknown } }]
    >) {
      expect(call[0].where).toMatchObject({
        version: { projectId: 'P1' },
        issue: { deletedAt: null, type: BUG_TYPE },
      });
    }
  });

  it('tổng hợp số liệu: mở, mới, đóng, mở lại, tỷ lệ, thời gian đóng', async () => {
    const { svc } = make();
    const r = await svc.report('W1', 'P1', '2026-10-01', '2026-10-15');
    expect(r.range.from).toBe('2026-10-01T00:00:00.000Z');
    expect(r.range.to).toBe('2026-10-15T23:59:59.999Z');
    expect(r.totals).toEqual({ open: 5, created: 7, closed: 4, reopened: 1 });
    expect(r.openBySeverity.map((s) => [s.name, s.open])).toEqual([
      ['Critical', 3],
      ['Chưa đặt', 2],
    ]);
    expect(r.reopenRate).toBe(0.25);
    expect(r.closeTime).toEqual({ avgHours: 4, medianHours: 4, sample: 2 });
  });

  it('theo release: ưu tiên AFFECTS khi có dòng', async () => {
    const { svc, prisma } = make({
      affects: [
        { versionId: 'v1', issue: { createdAt: T('2026-10-05'), status: { category: 'TODO' } } },
      ],
    });
    const r = await svc.report('W1', 'P1');
    expect(r.byRelease.basis).toBe('AFFECTS');
    expect(r.byRelease.rows[0]).toMatchObject({ versionId: 'v1', total: 1, open: 1, leaked: 1 });
    expect(prisma.issueFixVersion.findMany).toHaveBeenCalledTimes(1);
  });

  it('rơi về FIX khi AFFECTS rỗng và trả basis FIX', async () => {
    const { svc, prisma } = make({
      fix: [
        { versionId: 'v1', issue: { createdAt: T('2026-09-05'), status: { category: 'DONE' } } },
      ],
    });
    const r = await svc.report('W1', 'P1');
    expect(r.byRelease.basis).toBe('FIX');
    expect(r.byRelease.rows[0]).toMatchObject({ total: 1, closed: 1, leaked: 0 });
    expect(prisma.issueFixVersion.findMany).toHaveBeenCalledTimes(2);
  });

  it('không có dữ liệu: rỗng, basis AFFECTS, tỷ lệ null', async () => {
    const { svc, prisma } = make();
    prisma.issue.groupBy.mockResolvedValueOnce([]);
    prisma.issue.findMany.mockResolvedValueOnce([]);
    prisma.issueHistory.findMany.mockResolvedValue([]);
    const r = await svc.report('W1', 'P1');
    expect(r.totals.open).toBe(0);
    expect(r.reopenRate).toBeNull();
    expect(r.byRelease).toEqual({ basis: 'AFFECTS', rows: [] });
  });
});
