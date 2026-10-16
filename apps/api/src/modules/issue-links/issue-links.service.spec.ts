import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
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
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
  };
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

  it('đích ở dự án đã lưu trữ nhưng user không có quyền -> 403 (không lộ trạng thái lưu trữ)', async () => {
    const { service, prisma } = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    prisma.issue.findUnique.mockImplementation(((args: { where: { id: string } }) =>
      Promise.resolve({
        project: { archivedAt: args.where.id === 'b' ? new Date() : null },
      })) as never);
    await expect(service.create('w1', 'a', input, user)).rejects.toMatchObject({ status: 403 });
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

describe('IssueLinksService.create — không lộ sự tồn tại của issue đích', () => {
  it('đích không tồn tại và đích ở dự án không có quyền trả CÙNG một lỗi (403, cùng thông điệp)', async () => {
    const missing = setup([], { a: end('a', 'p1') });
    const denied = setup([], { a: end('a', 'p1'), b: end('b', 'p2') });
    const e1 = await missing.service.create('w1', 'a', input, user).catch((e: unknown) => e);
    const e2 = await denied.service.create('w1', 'a', input, user).catch((e: unknown) => e);
    expect(e1).toMatchObject({ status: 403 });
    expect(e2).toMatchObject({ status: 403 });
    expect((e1 as Error).message).toBe((e2 as Error).message);
    expect(missing.prisma.issueLink.create).not.toHaveBeenCalled();
  });

  it('tra issue đích với điều kiện dự án chưa xoá mềm', async () => {
    const { service, prisma } = setup(['issue:edit'], { a: end('a', 'p1'), b: end('b', 'p1') });
    await service.create('w1', 'a', input, user);
    const wheres = prisma.issue.findFirst.mock.calls.map((c) => c[0].where);
    const targetWhere = wheres.find((w) => w.id === 'b');
    expect(JSON.stringify(targetWhere)).toContain('"project":{"deletedAt":null}');
  });
});

describe('IssueLinksService.remove — link liên dự án', () => {
  function removeSetup(
    perms: string[],
    opts: { targetDeleted?: boolean; targetProject?: string } = {},
  ) {
    const s = setup(perms, {});
    const issueLink = {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'l1',
          sourceIssueId: 'a',
          targetIssueId: 'b',
          source: { projectId: 'p1' },
          target: {
            ...end('b', opts.targetProject ?? 'p2'),
            deletedAt: opts.targetDeleted ? new Date() : null,
          },
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

  it('khác dự án, có issue:edit ở đích -> xoá được', async () => {
    const s = removeSetup(['issue:edit']);
    await expect(s.service.remove('w1', 'l1', user)).resolves.toEqual({ success: true });
    expect(s.rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
    expect(s.issueLink.delete).toHaveBeenCalledTimes(1);
  });

  it('cùng dự án -> không kiểm quyền thêm', async () => {
    const s = removeSetup([], { targetProject: 'p1' });
    await expect(s.service.remove('w1', 'l1', user)).resolves.toEqual({ success: true });
    expect(s.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('system admin bỏ qua kiểm quyền ở đích', async () => {
    const s = removeSetup([]);
    await expect(s.service.remove('w1', 'l1', { id: 'u9', isSystemAdmin: true })).resolves.toEqual({
      success: true,
    });
    expect(s.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('issue đích đã xoá mềm -> dọn link không cần quyền ở đích', async () => {
    const s = removeSetup([], { targetDeleted: true });
    await expect(s.service.remove('w1', 'l1', user)).resolves.toEqual({ success: true });
    expect(s.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });
});

function listSetup(perms: Record<string, string[]>, rows: unknown[]) {
  const prisma = {
    issue: { findFirst: vi.fn(() => Promise.resolve(end('a', 'p1'))) },
    issueLink: { findMany: vi.fn(() => Promise.resolve(rows)) },
  };
  const rbac = {
    getEffectivePermissions: vi.fn((_u: string, _w: string, projectId: string) =>
      Promise.resolve(new Set(perms[projectId] ?? [])),
    ),
    assertProjectVisible: vi.fn(() => Promise.resolve()),
  };
  return { service: new IssueLinksService(prisma as never, rbac as never), prisma, rbac };
}
const linkRow = (id: string, other: ReturnType<typeof end>) => ({
  id,
  sourceIssueId: 'a',
  targetIssueId: other.id,
  linkTypeId: 'lt',
  linkType: { id: 'lt', name: 'n', outwardName: 'chặn', inwardName: 'bị chặn bởi' },
  source: end('a', 'p1'),
  target: other,
});

describe('IssueLinksService.listForIssue — không rò issue ở dự án không xem được', () => {
  it('đầu kia ở dự án khác và người gọi không có project:view ở đó -> bị ẩn', async () => {
    const { service, rbac } = listSetup({ p2: [] }, [
      linkRow('l1', end('b', 'p2')),
      linkRow('l2', end('c', 'p1')),
    ]);
    const out = await service.listForIssue('w1', 'a', user);
    expect(out.map((l) => l.id)).toEqual(['l2']);
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p2');
  });

  it('có project:view ở dự án kia -> hiện; mỗi dự án chỉ tra quyền một lần', async () => {
    const { service, rbac } = listSetup({ p2: ['project:view'] }, [
      linkRow('l1', end('b', 'p2')),
      linkRow('l2', end('d', 'p2')),
    ]);
    expect((await service.listForIssue('w1', 'a', user)).map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(rbac.getEffectivePermissions).toHaveBeenCalledTimes(1);
  });

  it('cùng dự án với issue đang xem và system admin -> không tra quyền', async () => {
    const same = listSetup({}, [linkRow('l1', end('c', 'p1'))]);
    await same.service.listForIssue('w1', 'a', user);
    expect(same.rbac.getEffectivePermissions).not.toHaveBeenCalled();
    const admin = listSetup({}, [linkRow('l1', end('b', 'p2'))]);
    expect(
      await admin.service.listForIssue('w1', 'a', { id: 'u9', isSystemAdmin: true }),
    ).toHaveLength(1);
    expect(admin.rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('where loại issue đầu kia đã xoá mềm / dự án xoá mềm', async () => {
    const { service, prisma } = listSetup({}, []);
    await service.listForIssue('w1', 'a', user);
    const where = JSON.stringify(
      (prisma.issueLink.findMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where,
    );
    expect(where).toContain('"deletedAt":null');
    expect(where).toContain('"project":{"deletedAt":null}');
    expect(where).toContain('"workspaceId":"w1"'); // phòng thủ link chéo workspace cũ
  });
});

describe('IssueLinksService — dự án riêng tư (P13)', () => {
  const hidden = () =>
    vi.fn((_u: string, _w: string, projectId: string) =>
      projectId === 'p2' ? Promise.reject(new NotFoundAppException('Dự án')) : Promise.resolve(),
    );

  it('create: đích thuộc dự án riêng tư người gọi không thấy -> 403 cùng lỗi với đích không tồn tại', async () => {
    const hiddenTarget = setup(['issue:edit'], { a: end('a', 'p1'), b: end('b', 'p2') });
    hiddenTarget.rbac.assertProjectVisible = hidden();
    const missing = setup(['issue:edit'], { a: end('a', 'p1') });
    const e1 = await hiddenTarget.service.create('w1', 'a', input, user).catch((e: unknown) => e);
    const e2 = await missing.service.create('w1', 'a', input, user).catch((e: unknown) => e);
    expect(e1).toMatchObject({ status: 403 });
    expect((e1 as Error).message).toBe((e2 as Error).message);
    expect(hiddenTarget.prisma.issueLink.create).not.toHaveBeenCalled();
  });

  it('create: thành viên dự án riêng tư (thấy được) -> tạo được', async () => {
    const { service, prisma } = setup(['issue:edit'], { a: end('a', 'p1'), b: end('b', 'p2') });
    await expect(service.create('w1', 'a', input, user)).resolves.toMatchObject({ id: 'l1' });
    expect(prisma.issueLink.create).toHaveBeenCalledTimes(1);
  });

  it('listForIssue: đầu kia ở dự án riêng tư người xem không thấy -> ẩn dù có project:view', async () => {
    const { service, rbac } = listSetup({ p2: ['project:view'] }, [
      linkRow('l1', end('b', 'p2')),
      linkRow('l2', end('c', 'p1')),
    ]);
    rbac.assertProjectVisible = hidden();
    const out = await service.listForIssue('w1', 'a', user);
    expect(out.map((l) => l.id)).toEqual(['l2']);
  });
});
