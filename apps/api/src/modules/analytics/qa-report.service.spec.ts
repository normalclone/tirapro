import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { QaReportService } from './qa-report.service';

type Over = {
  project?: unknown;
  affects?: unknown[];
  fix?: unknown[];
  events?: unknown;
  close?: unknown;
  groups?: unknown[];
};

const flat = (q: Prisma.Sql) => q.sql.replace(/\s+/g, ' ');

function make(over: Over = {}) {
  const queryRaw = vi.fn((q: Prisma.Sql) => {
    const s = q.sql;
    if (s.includes('"IssueHistory"'))
      return Promise.resolve([over.events ?? { closed: 4n, reopened: 2n, both: 1n }]);
    if (s.includes('percentile_cont'))
      return Promise.resolve([over.close ?? { n: 2n, avgHours: 4, medianHours: 4 }]);
    if (s.includes('"IssueFixVersion"')) {
      return Promise.resolve(
        q.values.includes('AFFECTS') ? (over.affects ?? []) : (over.fix ?? []),
      );
    }
    return Promise.resolve([]);
  });
  const prisma = {
    project: {
      findFirst: vi.fn((_args: unknown) =>
        Promise.resolve('project' in over ? over.project : { id: 'P1' }),
      ),
    },
    issue: {
      groupBy: vi.fn((_args: unknown) =>
        Promise.resolve(
          over.groups ?? [
            { severityId: 's1', _count: { _all: 3 } },
            { severityId: null, _count: { _all: 2 } },
          ],
        ),
      ),
      count: vi.fn((_args: unknown) => Promise.resolve(7)),
    },
    severity: {
      findMany: vi.fn(() =>
        Promise.resolve([{ id: 's1', name: 'Critical', color: '#f00', rank: 4 }]),
      ),
    },
    version: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'v1', name: '1.0', status: 'RELEASED', releaseDate: new Date('2026-10-01') },
        ]),
      ),
    },
    $queryRaw: queryRaw,
  };
  return { prisma, queryRaw, svc: new QaReportService(prisma as never) };
}

const BUG_TYPE = { OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }] };
const TRIAGE_OK = { OR: [{ triageState: null }, { triageState: 'ACCEPTED' }] };
const FROM = '2026-10-01';
const TO = '2026-10-15';

describe('QaReportService.report — truy cập và tham số', () => {
  it('dự án không thuộc workspace => 404', async () => {
    const { svc } = make({ project: null });
    await expect(svc.report('W1', 'PX')).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('from/to sai định dạng, đảo ngược => BusinessRuleException', async () => {
    const { svc } = make();
    await expect(svc.report('W1', 'P1', 'abc')).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(svc.report('W1', 'P1', '2026-10-10', '2026-10-01')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('truyền ISO có múi giờ: kỳ được dùng nguyên văn (không cắt về UTC)', async () => {
    const { svc } = make();
    const r = await svc.report(
      'W1',
      'P1',
      '2026-10-10T00:00:00+07:00',
      '2026-10-16T23:59:59.999+07:00',
    );
    expect(r.range).toEqual({ from: '2026-10-09T17:00:00.000Z', to: '2026-10-16T16:59:59.999Z' });
  });
});

describe('QaReportService.report — điều kiện làm nên định nghĩa', () => {
  it('bug mở: groupBy khoá dự án, chưa xoá, loại Bug, đã duyệt, và LOẠI nhóm DONE', async () => {
    const { svc, prisma } = make();
    await svc.report('W1', 'P1', FROM, TO);
    const arg = prisma.issue.groupBy.mock.calls[0]![0] as { by: string[]; where: object };
    expect(arg.by).toEqual(['severityId']);
    expect(arg.where).toMatchObject({
      projectId: 'P1',
      deletedAt: null,
      type: BUG_TYPE,
      ...TRIAGE_OK,
      status: { category: { not: 'DONE' } },
    });
  });

  it('bug mới trong kỳ: cùng bộ lọc (đã duyệt) + createdAt trong [from,to]', async () => {
    const { svc, prisma } = make();
    await svc.report('W1', 'P1', FROM, TO);
    const arg = prisma.issue.count.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      projectId: 'P1',
      deletedAt: null,
      type: BUG_TYPE,
      ...TRIAGE_OK,
      createdAt: {
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lte: new Date('2026-10-15T23:59:59.999Z'),
      },
    });
    // không nhóm "triageState" bị ghi đè bởi điều kiện khác
    expect(arg.where.OR).toEqual(TRIAGE_OK.OR);
  });

  it('sự kiện: đóng = sang DONE từ không-DONE HOẶC null; mở lại = từ DONE sang không-DONE; khoá dự án + kỳ + bug đã duyệt', async () => {
    const { svc, queryRaw } = make();
    await svc.report('W1', 'P1', FROM, TO);
    const q = queryRaw.mock.calls.map((c) => c[0]).find((x) => x.sql.includes('"IssueHistory"'))!;
    const s = flat(q);
    expect(s).toContain(
      `h."newCategory"::text = 'DONE' AND (h."oldCategory" IS NULL OR h."oldCategory"::text <> 'DONE')`,
    );
    expect(s).toContain(
      `h."oldCategory"::text = 'DONE' AND h."newCategory" IS NOT NULL AND h."newCategory"::text <> 'DONE'`,
    );
    expect(s).toContain(`h."field"::text = 'STATUS'`);
    expect(s).toContain(`h."projectId" = ?`);
    expect(s).toMatch(/h\."occurredAt" >= .* AND h\."occurredAt" <= /);
    expect(s).toContain(`i."deletedAt" IS NULL`);
    expect(s).toContain(`i."triageState" IS NULL OR i."triageState"::text = 'ACCEPTED'`);
    expect(s).toContain(`lower(t."name") = 'bug'`);
    expect(q.values[0]).toBe('P1');
  });

  it('thời gian đóng: bug HIỆN ở DONE, resolvedAt trong kỳ, không âm, percentile_cont, đã duyệt', async () => {
    const { svc, queryRaw } = make();
    await svc.report('W1', 'P1', FROM, TO);
    const q = queryRaw.mock.calls.map((c) => c[0]).find((x) => x.sql.includes('percentile_cont'))!;
    const s = flat(q);
    expect(s).toContain(`s."category"::text = 'DONE'`);
    expect(s).toMatch(/i\."resolvedAt" >= .* AND i\."resolvedAt" <= /);
    expect(s).toContain(`i."resolvedAt" >= i."createdAt"`);
    expect(s).toContain(`percentile_cont(0.5)`);
    expect(s).toContain(`i."projectId" = ?`);
    expect(s).toContain(`i."triageState" IS NULL OR i."triageState"::text = 'ACCEPTED'`);
    expect(q.values[0]).toBe('P1');
  });

  it('theo phiên bản: khoá dự án, đã duyệt, rò rỉ = báo SAU HẾT ngày phát hành', async () => {
    const { svc, queryRaw } = make();
    await svc.report('W1', 'P1', FROM, TO);
    const q = queryRaw.mock.calls
      .map((c) => c[0])
      .find((x) => x.sql.includes('"IssueFixVersion"'))!;
    const s = flat(q);
    expect(s).toContain(`v."projectId" = ?`);
    expect(s).toContain(`i."deletedAt" IS NULL`);
    expect(s).toContain(`i."triageState" IS NULL OR i."triageState"::text = 'ACCEPTED'`);
    expect(s).toContain(`i."createdAt" >= date_trunc('day', v."releaseDate") + interval '1 day'`);
    expect(q.values).toContain('AFFECTS');
  });
});

describe('QaReportService.report — kết quả', () => {
  it('tổng hợp: mở = tổng theo mức, mới, đóng, mở lại, tỷ lệ = đóng∩mở lại / đóng, thời gian đóng', async () => {
    const { svc } = make();
    const r = await svc.report('W1', 'P1', FROM, TO);
    expect(r.range).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-15T23:59:59.999Z' });
    expect(r.totals).toEqual({ open: 5, created: 7, closed: 4, reopened: 2 });
    expect(r.openBySeverity.map((s) => [s.name, s.open])).toEqual([
      ['Critical', 3],
      ['Chưa đặt', 2],
    ]);
    expect(r.reopenRate).toBe(0.25);
    expect(r.closeTime).toEqual({ avgHours: 4, medianHours: 4, sample: 2 });
  });

  it('theo release: ưu tiên AFFECTS khi có dòng (không truy vấn FIX)', async () => {
    const { svc, queryRaw } = make({
      affects: [{ versionId: 'v1', total: 1n, open: 1n, closed: 0n, leaked: 1n }],
    });
    const r = await svc.report('W1', 'P1');
    expect(r.byRelease.basis).toBe('AFFECTS');
    expect(r.byRelease.rows[0]).toMatchObject({ versionId: 'v1', total: 1, open: 1, leaked: 1 });
    expect(queryRaw.mock.calls.filter((c) => c[0].sql.includes('"IssueFixVersion"'))).toHaveLength(
      1,
    );
  });

  it('rơi về FIX khi AFFECTS rỗng và trả basis FIX', async () => {
    const { svc, queryRaw } = make({
      fix: [{ versionId: 'v1', total: 1n, open: 0n, closed: 1n, leaked: 0n }],
    });
    const r = await svc.report('W1', 'P1');
    expect(r.byRelease.basis).toBe('FIX');
    expect(r.byRelease.rows[0]).toMatchObject({ total: 1, closed: 1 });
    const fixCall = queryRaw.mock.calls
      .map((c) => c[0])
      .filter((q) => q.sql.includes('"IssueFixVersion"'))[1]!;
    expect(fixCall.values).toContain('FIX');
  });

  it('không có dữ liệu: rỗng, tỷ lệ null, thời gian đóng null', async () => {
    const { svc } = make({
      groups: [],
      events: { closed: 0n, reopened: 0n, both: 0n },
      close: { n: 0n, avgHours: null, medianHours: null },
    });
    const r = await svc.report('W1', 'P1');
    expect(r.totals.open).toBe(0);
    expect(r.reopenRate).toBeNull();
    expect(r.closeTime).toEqual({ avgHours: null, medianHours: null, sample: 0 });
    expect(r.byRelease).toEqual({ basis: 'AFFECTS', rows: [] });
  });
});
