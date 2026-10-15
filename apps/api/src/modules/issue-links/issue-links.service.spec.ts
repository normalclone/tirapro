import { describe, expect, it, vi } from 'vitest';
import { IssueLinksService } from './issue-links.service';

const end = (id: string, projectId: string, over: Record<string, unknown> = {}) => ({
  id,
  key: `K-${id}`,
  summary: id,
  status: { name: 'Todo', category: 'TODO' },
  projectId,
  reporterId: 'owner',
  assigneeId: null,
  createdById: 'owner',
  ...over,
});

function setup(perms: string[], issues: Record<string, ReturnType<typeof end>>) {
  const prisma = {
    issue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(issues[where.id] ?? null),
      ),
      findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
    },
    linkType: {
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'lt', name: 'n', outwardName: 'o', inwardName: 'i' }),
      ),
    },
    issueLink: {
      create: vi.fn(() =>
        Promise.resolve({ id: 'l1', sourceIssueId: 'a', targetIssueId: 'b', linkTypeId: 'lt' }),
      ),
    },
  };
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { service: new IssueLinksService(prisma as never, rbac as never), prisma, rbac };
}
const input = { targetIssueId: 'b', linkTypeId: 'lt' };
const user = { id: 'u1', isSystemAdmin: false };

describe('IssueLinksService.create — link liên dự án', () => {
  it('khác dự án và không có quyền sửa ở dự án đích -> 403, không tạo link', async () => {
    const { service, prisma, rbac } = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(service.create('w1', 'a', input, user)).rejects.toMatchObject({ status: 403 });
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    expect(prisma.issueLink.create).not.toHaveBeenCalled();
  });

  it('khác dự án, có issue:edit ở đích -> tạo được', async () => {
    const { service, prisma } = setup(['issue:edit'], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(service.create('w1', 'a', input, user)).resolves.toMatchObject({ id: 'l1' });
    expect(prisma.issueLink.create).toHaveBeenCalledTimes(1);
  });

  it('khác dự án, chỉ issue:edit:own ở đích: chỉ qua khi là chủ issue đích', async () => {
    const notOwner = setup(['issue:edit:own'], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(notOwner.service.create('w1', 'a', input, user)).rejects.toMatchObject({
      status: 403,
    });
    const owner = setup(['issue:edit:own'], {
      a: end('a', 'p1'),
      b: end('b', 'p2', { assigneeId: 'u1' }),
    });
    await expect(owner.service.create('w1', 'a', input, user)).resolves.toBeDefined();
  });

  it('cùng dự án -> không kiểm quyền thêm; system admin bỏ qua', async () => {
    const same = setup([], { a: end('a', 'p1'), b: end('b', 'p1') });
    await same.service.create('w1', 'a', input, user);
    expect(same.rbac.getEffectivePermissions).not.toHaveBeenCalled();
    const admin = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    await admin.service.create('w1', 'a', input, { id: 'u9', isSystemAdmin: true });
    expect(admin.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });
});

describe('IssueLinksService.remove — link liên dự án', () => {
  function removeSetup(perms: string[], targetDeleted = false) {
    const s = setup(perms, {});
    const issueLink = {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'l1',
          sourceIssueId: 'a',
          targetIssueId: 'b',
          source: { projectId: 'p1' },
          target: { ...end('b', 'p2'), deletedAt: targetDeleted ? new Date() : null },
        }),
      ),
      delete: vi.fn(() => Promise.resolve({})),
    };
    (s.prisma as Record<string, unknown>).issueLink = issueLink;
    return { ...s, issueLink };
  }

  it('khác dự án, không có quyền ở đích -> 403, không xoá', async () => {
    const s = removeSetup([]);
    await expect(s.service.remove('w1', 'l1', user)).rejects.toMatchObject({ status: 403 });
    expect(s.issueLink.delete).not.toHaveBeenCalled();
  });

  it('issue đích đã xoá mềm -> dọn link không cần quyền ở đích', async () => {
    const s = removeSetup([], true);
    await expect(s.service.remove('w1', 'l1', user)).resolves.toEqual({ success: true });
  });
});
