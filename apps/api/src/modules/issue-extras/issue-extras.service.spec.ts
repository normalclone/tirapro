import { describe, expect, it, vi } from 'vitest';
import { IssueExtrasService } from './issue-extras.service';

const issue = {
  id: 'i1',
  projectId: 'p1',
  reporterId: 'rep',
  assigneeId: 'dev',
  createdById: 'rep',
};

function make(perms: string[]) {
  const update = vi.fn(() => Promise.resolve({ id: 'c1', done: true }));
  const prisma = {
    issue: {
      findFirst: vi.fn(() => Promise.resolve(issue)),
      findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
    },
    checklistItem: { findFirst: vi.fn(() => Promise.resolve({ id: 'c1' })), update },
  };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return {
    service: new IssueExtrasService(prisma as never, rbac as never),
    update,
  };
}

describe('IssueExtrasService.updateChecklistItem — quyền tick bước (logbug #15)', () => {
  it('người được giao KHÔNG có issue:edit vẫn tick được (chỉ đổi done)', async () => {
    const { service, update } = make(['project:view']);
    await service.updateChecklistItem('w', 'i1', 'c1', { done: true }, { id: 'dev' });
    expect(update).toHaveBeenCalled();
  });
  it('người được giao không có issue:edit thì không sửa chữ/thứ tự bước', async () => {
    const { service } = make(['project:view']);
    await expect(
      service.updateChecklistItem('w', 'i1', 'c1', { text: 'x' }, { id: 'dev' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('người không liên quan, không có issue:edit → 403 kể cả khi chỉ tick', async () => {
    const { service } = make(['project:view']);
    await expect(
      service.updateChecklistItem('w', 'i1', 'c1', { done: true }, { id: 'other' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('có issue:edit → sửa được; issue:edit:own chỉ với việc của mình; system admin luôn được', async () => {
    const a = make(['issue:edit']);
    await a.service.updateChecklistItem('w', 'i1', 'c1', { text: 'x' }, { id: 'other' });
    expect(a.update).toHaveBeenCalled();
    const own = make(['issue:edit:own']);
    await expect(
      own.service.updateChecklistItem('w', 'i1', 'c1', { done: true }, { id: 'other' }),
    ).rejects.toMatchObject({ status: 403 });
    await own.service.updateChecklistItem('w', 'i1', 'c1', { text: 'y' }, { id: 'rep' });
    expect(own.update).toHaveBeenCalled();
    const admin = make([]);
    await admin.service.updateChecklistItem(
      'w',
      'i1',
      'c1',
      { done: true },
      {
        id: 'z',
        isSystemAdmin: true,
      },
    );
    expect(admin.update).toHaveBeenCalled();
  });
});
