import { describe, expect, it, vi } from 'vitest';
import { AdminWorkspacesService } from './admin-workspaces.service';
import { SYSTEM_USER_EMAIL } from '../../common/system-user';

function setup() {
  const row = {
    id: 'w1',
    name: 'WS',
    slug: 'ws',
    plan: 'FREE',
    deletedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    owner: { id: 'u1', displayName: 'An', email: 'an@x.vn', avatarUrl: null },
    _count: { memberships: 7, projects: 2, issues: 30 },
  };
  const prisma = {
    workspace: { findMany: vi.fn(() => Promise.resolve([row])) },
    activityLog: { groupBy: vi.fn(() => Promise.resolve([])) },
  };
  return { svc: new AdminWorkspacesService(prisma as never), prisma };
}

describe('AdminWorkspacesService.list — số thành viên', () => {
  it('đếm cùng quy tắc "đang hoạt động" như bộ chọn không gian: bỏ DEACTIVATED và user hệ thống', async () => {
    const { svc, prisma } = setup();
    const page = await svc.list();
    const arg = (prisma.workspace.findMany.mock.calls[0] as unknown[])[0] as {
      select: { _count: { select: { memberships: unknown } } };
    };
    expect(arg.select._count.select.memberships).toEqual({
      where: { user: { status: { not: 'DEACTIVATED' }, email: { not: SYSTEM_USER_EMAIL } } },
    });
    expect(page.data[0]).toMatchObject({ members: 7, projects: 2, issues: 30 });
  });
});
