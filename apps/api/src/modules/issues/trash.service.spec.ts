import { describe, expect, it, vi } from 'vitest';
import { TrashService } from './trash.service';

describe('TrashService.list', () => {
  it('chỉ lấy việc đã xoá của đúng dự án/workspace, mới xoá lên trước, kèm tên người xoá', async () => {
    const del = new Date('2026-10-16T09:00:00Z');
    const issue = {
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            id: 'i1',
            key: 'DEMO-1',
            summary: 'Lỗi thanh toán',
            deletedAt: del,
            updatedById: 'u2',
            type: { name: 'Bug', color: '#f00' },
          },
          {
            id: 'i2',
            key: 'DEMO-2',
            summary: 'Khác',
            deletedAt: del,
            updatedById: null,
            type: { name: 'Task', color: null },
          },
        ]),
      ),
    };
    const user = {
      findMany: vi.fn(() => Promise.resolve([{ id: 'u2', displayName: 'Trang' }])),
    };
    const service = new TrashService({ issue, user } as never);
    const out = await service.list('w1', 'p1');
    expect(issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', projectId: 'p1', deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
      }),
    );
    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['u2'] } } }),
    );
    expect(out).toEqual([
      {
        id: 'i1',
        key: 'DEMO-1',
        summary: 'Lỗi thanh toán',
        type: { name: 'Bug', color: '#f00' },
        deletedAt: del.toISOString(),
        deletedBy: { id: 'u2', displayName: 'Trang' },
      },
      {
        id: 'i2',
        key: 'DEMO-2',
        summary: 'Khác',
        type: { name: 'Task', color: null },
        deletedAt: del.toISOString(),
        deletedBy: null,
      },
    ]);
  });

  it('không tra người dùng khi không có ai', async () => {
    const issue = { findMany: vi.fn(() => Promise.resolve([])) };
    const user = { findMany: vi.fn() };
    const out = await new TrashService({ issue, user } as never).list('w1', 'p1');
    expect(out).toEqual([]);
    expect(user.findMany).not.toHaveBeenCalled();
  });
});
