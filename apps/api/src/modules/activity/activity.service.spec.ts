import { describe, expect, it, vi } from 'vitest';
import { ActivityService } from './activity.service';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'h1',
  issueId: 'i1',
  field: 'DESCRIPTION',
  oldValue: 'a'.repeat(500),
  newValue: 'b',
  oldCategory: null,
  newCategory: null,
  pointsDelta: null,
  actorId: 'u1',
  occurredAt: new Date('2026-10-16T00:00:00Z'),
  ...o,
});

function setup(rows: unknown[]) {
  const prisma = {
    issue: { findFirst: vi.fn(() => Promise.resolve({ id: 'i1' })) },
    issueHistory: {
      findMany: vi.fn((_a: { where: unknown }) => Promise.resolve(rows)),
      findFirst: vi.fn((_a: { where: unknown }) => Promise.resolve(rows[0] ?? null)),
    },
    user: {
      findMany: vi.fn(() => Promise.resolve([{ id: 'u1', displayName: 'An', avatarUrl: null }])),
    },
    sprint: { findMany: vi.fn(() => Promise.resolve([])) },
  };
  return { service: new ActivityService(prisma as never), prisma };
}

describe('ActivityService (B19)', () => {
  it('lọc theo fields: truyền vào where', async () => {
    const { service, prisma } = setup([]);
    await service.listForIssue('w1', 'i1', ['STATUS', 'DESCRIPTION']);
    expect(prisma.issueHistory.findMany.mock.calls[0]![0].where).toEqual({
      issueId: 'i1',
      field: { in: ['STATUS', 'DESCRIPTION'] },
    });
  });
  it('không truyền fields => không lọc', async () => {
    const { service, prisma } = setup([]);
    await service.listForIssue('w1', 'i1');
    expect(prisma.issueHistory.findMany.mock.calls[0]![0].where).toEqual({ issueId: 'i1' });
  });
  it('DESCRIPTION trong danh sách chỉ là bản xem trước ≤ 200 ký tự kèm hasDiff', async () => {
    const { service } = setup([row()]);
    const [d] = await service.listForIssue('w1', 'i1');
    expect(d!.hasDiff).toBe(true);
    expect(d!.oldValue!.length).toBeLessThanOrEqual(201);
    expect(d!.oldValue!.endsWith('…')).toBe(true);
    expect(d!.newValue).toBe('b');
  });
  it('trường khác không có hasDiff và giữ nguyên giá trị', async () => {
    const { service } = setup([row({ field: 'PRIORITY', oldValue: 'High', newValue: 'Low' })]);
    const [d] = await service.listForIssue('w1', 'i1');
    expect(d).toMatchObject({ hasDiff: false, oldValue: 'High', newValue: 'Low' });
  });
  it('getOne trả bản ĐẦY ĐỦ, thuộc đúng issue; không thấy => 404', async () => {
    const { service, prisma } = setup([row()]);
    const full = await service.getOne('w1', 'i1', 'h1');
    expect(full.oldValue).toHaveLength(500);
    expect(prisma.issueHistory.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'h1',
      issueId: 'i1',
    });
    const none = setup([]);
    await expect(none.service.getOne('w1', 'i1', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
