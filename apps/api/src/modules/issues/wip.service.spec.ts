import { describe, expect, it, vi } from 'vitest';
import { hasTriageVisible } from '../../common/triage-visibility.testutil';
import { WipService } from './wip.service';

describe('WipService.resolveWipColumn', () => {
  it('không có boardId => null, không chạm DB', async () => {
    const prisma = { boardColumn: { findFirst: vi.fn() } };
    const svc = new WipService(prisma as never, {} as never);
    await expect(svc.resolveWipColumn(undefined, 'p1', 's2')).resolves.toBeNull();
    expect(prisma.boardColumn.findFirst).not.toHaveBeenCalled();
  });
});

describe('WipService.enforceWip — việc chưa duyệt không ăn chỗ WIP', () => {
  const wip = { id: 'c1', name: 'To Do', wipLimit: 3, statusIds: ['s1'], boardType: 'KANBAN' };
  const ctx = { userId: 'u1', workspaceId: 'w1', projectId: 'p1', incoming: 1 };

  function make(boardType: string, count: number) {
    const tx = {
      $queryRaw: vi.fn(() => Promise.resolve([])),
      sprint: { findFirst: vi.fn(() => Promise.resolve({ id: 'sp1' })) },
      issue: { count: vi.fn((_a: { where: Record<string, unknown> }) => Promise.resolve(count)) },
    };
    return { tx, svc: new WipService({} as never, {} as never), wip: { ...wip, boardType } };
  }

  it('Kanban: đếm WIP lọc TRIAGE_VISIBLE (khớp số thẻ Board hiện) và vẫn lọc xoá mềm + trạng thái cột', async () => {
    const m = make('KANBAN', 0);
    await m.svc.enforceWip(m.tx as never, m.wip, ctx);
    const where = m.tx.issue.count.mock.calls[0]![0].where;
    expect(hasTriageVisible(where)).toBe(true);
    expect(where).toMatchObject({ projectId: 'p1', deletedAt: null, statusId: { in: ['s1'] } });
  });

  it('Scrum: vẫn giới hạn theo sprint ACTIVE và lọc TRIAGE_VISIBLE', async () => {
    const m = make('SCRUM', 0);
    await m.svc.enforceWip(m.tx as never, m.wip, ctx);
    const where = m.tx.issue.count.mock.calls[0]![0].where;
    expect(hasTriageVisible(where)).toBe(true);
    expect(where).toMatchObject({ sprintId: 'sp1' });
  });
});
