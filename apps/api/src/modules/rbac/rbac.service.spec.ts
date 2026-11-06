import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { describe, expect, it, vi } from 'vitest';
import { RbacService } from './rbac.service';

function makeStream(batches: string[][]) {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const b of batches) yield b;
    },
  };
}

function setup(redis: 'ok' | 'down' = 'ok') {
  const client = {
    scanStream: vi.fn((_opts: unknown) =>
      makeStream([['rbac:org:W1:U1:-', 'rbac:org:W1:U1:P1'], [], ['rbac:org:W1:U1:P2']]),
    ),
    unlink: vi.fn((..._keys: string[]) => Promise.resolve(1)),
    keys: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const redisSvc = {
    getClient: () => client,
    isAvailable: () => redis === 'ok',
  };
  const prisma = {
    project: { findFirst: vi.fn() },
    issue: { findFirst: vi.fn() },
    sprint: { findFirst: vi.fn() },
    board: { findFirst: vi.fn() },
    label: { findFirst: vi.fn() },
    component: { findFirst: vi.fn() },
    raidItem: { findFirst: vi.fn() },
    objective: { findFirst: vi.fn() },
    slaPolicy: { findFirst: vi.fn() },
    issueTemplate: { findFirst: vi.fn() },
    recurringIssue: { findFirst: vi.fn() },
    customField: { findFirst: vi.fn() },
    codeRepository: { findFirst: vi.fn() },
    comment: { findFirst: vi.fn() },
    attachment: { findFirst: vi.fn() },
    workLog: { findFirst: vi.fn() },
    issueLink: { findFirst: vi.fn() },
    version: { findFirst: vi.fn() },
    wikiPage: { findFirst: vi.fn() },
    user: {
      findUnique: vi.fn((_a?: unknown) =>
        Promise.resolve({ isSystemAdmin: false } as { isSystemAdmin: boolean } | null),
      ),
    },
    organizationMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
    projectMembership: { findUnique: vi.fn(() => Promise.resolve(null)) },
    rolePermission: { findMany: vi.fn(() => Promise.resolve([])) },
    role: { findMany: vi.fn(() => Promise.resolve([])) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new RbacService(prisma as any, redisSvc as any);
  return { svc, client, prisma };
}

describe('RbacService cache invalidation', () => {
  it('invalidateOrganization dùng SCAN + UNLINK, không dùng KEYS', async () => {
    const { svc, client } = setup();
    await svc.invalidateOrganization('W1');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scanStream).toHaveBeenCalledWith({ match: 'rbac:org:W1:*', count: 200 });
    expect(client.unlink).toHaveBeenCalledTimes(2); // batch rỗng bị bỏ qua
    expect(client.unlink).toHaveBeenCalledWith('rbac:org:W1:U1:-', 'rbac:org:W1:U1:P1');
    expect(client.unlink).toHaveBeenCalledWith('rbac:org:W1:U1:P2');
  });

  it('invalidate (1 user) dùng SCAN theo user', async () => {
    const { svc, client } = setup();
    await svc.invalidate('U1', 'W1');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scanStream).toHaveBeenCalledWith({ match: 'rbac:org:W1:U1:*', count: 200 });
    expect(client.unlink).toHaveBeenCalled();
  });

  it('Redis không sẵn sàng -> bỏ qua, không ném lỗi', async () => {
    const { svc, client } = setup('down');
    await expect(svc.invalidateOrganization('W1')).resolves.toBeUndefined();
    expect(client.scanStream).not.toHaveBeenCalled();
  });

  it('lỗi khi SCAN bị nuốt (degrade)', async () => {
    const { svc, client } = setup();
    client.scanStream.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(svc.invalidateOrganization('W1')).resolves.toBeUndefined();
  });
});

// Bảng tra project theo từng loại tài nguyên: mỗi loại một ca nên khối dài hơn ngưỡng hàm của lint.
/* eslint-disable max-lines-per-function */
describe('RbacService.resolveProjectId', () => {
  it('issue: findFirst theo organizationId, trả projectId', async () => {
    const { svc, prisma } = setup();
    prisma.issue.findFirst.mockResolvedValue({ projectId: 'P1' });
    await expect(svc.resolveProjectId('W1', 'issue', 'I1')).resolves.toEqual({ projectId: 'P1' });
    expect(prisma.issue.findFirst).toHaveBeenCalledWith({
      where: { id: 'I1', organizationId: 'W1', project: { deletedAt: null } },
      select: { projectId: true },
    });
  });

  it('issue của dự án đã xoá mềm => findFirst không khớp => resolveProjectId trả null (guard 404)', async () => {
    const { svc, prisma } = setup();
    prisma.issue.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'issue', 'I-cua-du-an-da-xoa')).resolves.toBeNull();
  });

  it.each(['sprint', 'board', 'label', 'component', 'version', 'recurringIssue'] as const)(
    '%s: lọc qua project.organizationId và loại dự án đã xoá mềm (guard 404)',
    async (kind) => {
      const { svc, prisma } = setup();
      prisma[kind].findFirst.mockResolvedValue({ projectId: 'P9' });
      await expect(svc.resolveProjectId('W1', kind, 'X1')).resolves.toEqual({ projectId: 'P9' });
      expect(prisma[kind].findFirst).toHaveBeenCalledWith({
        where: { id: 'X1', project: { organizationId: 'W1', deletedAt: null } },
        select: { projectId: true },
      });
    },
  );

  it('comment: đi qua issue.organizationId, comment ngoài organization -> null (guard sẽ NotFound)', async () => {
    const { svc, prisma } = setup();
    prisma.comment.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'comment', 'C-ws-khac')).resolves.toBeNull();
    expect(prisma.comment.findFirst).toHaveBeenCalledWith({
      where: { id: 'C-ws-khac', issue: { organizationId: 'W1', project: { deletedAt: null } } },
      select: { issue: { select: { projectId: true } } },
    });
  });

  it('comment trong organization -> projectId của issue cha', async () => {
    const { svc, prisma } = setup();
    prisma.comment.findFirst.mockResolvedValue({ issue: { projectId: 'P7' } });
    await expect(svc.resolveProjectId('W1', 'comment', 'C1')).resolves.toEqual({ projectId: 'P7' });
  });

  it('attachment: gắn trực tiếp vào issue hoặc qua comment', async () => {
    const { svc, prisma } = setup();
    prisma.attachment.findFirst.mockResolvedValueOnce({
      issue: { projectId: 'P1' },
      comment: null,
    });
    await expect(svc.resolveProjectId('W1', 'attachment', 'A1')).resolves.toEqual({
      projectId: 'P1',
    });
    prisma.attachment.findFirst.mockResolvedValueOnce({
      issue: null,
      comment: { issue: { projectId: 'P2' } },
    });
    await expect(svc.resolveProjectId('W1', 'attachment', 'A2')).resolves.toEqual({
      projectId: 'P2',
    });
    prisma.attachment.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resolveProjectId('W1', 'attachment', 'A3')).resolves.toBeNull();
  });

  it('issueLink: một trong hai đầu thuộc organization; lấy projectId của đầu nguồn nếu có', async () => {
    const { svc, prisma } = setup();
    prisma.issueLink.findFirst.mockResolvedValue({
      source: { projectId: 'P1', organizationId: 'W1' },
      target: { projectId: 'P2', organizationId: 'W1' },
    });
    await expect(svc.resolveProjectId('W1', 'issueLink', 'L1')).resolves.toEqual({
      projectId: 'P1',
    });
    expect(prisma.issueLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'L1',
          source: { project: { deletedAt: null } },
          target: { project: { deletedAt: null } },
          OR: [{ source: { organizationId: 'W1' } }, { target: { organizationId: 'W1' } }],
        },
      }),
    );
  });

  it('issueLink: đầu nguồn ở organization khác thì dùng đầu đích trong organization', async () => {
    const { svc, prisma } = setup();
    prisma.issueLink.findFirst.mockResolvedValue({
      source: { projectId: 'PX', organizationId: 'W2' },
      target: { projectId: 'P2', organizationId: 'W1' },
    });
    await expect(svc.resolveProjectId('W1', 'issueLink', 'L1')).resolves.toEqual({
      projectId: 'P2',
    });
  });

  it('version: lọc qua project.organizationId', async () => {
    const { svc, prisma } = setup();
    prisma.version.findFirst.mockResolvedValue({ projectId: 'P3' });
    await expect(svc.resolveProjectId('W1', 'version', 'V1')).resolves.toEqual({ projectId: 'P3' });
    expect(prisma.version.findFirst).toHaveBeenCalledWith({
      where: { id: 'V1', project: { organizationId: 'W1', deletedAt: null } },
      select: { projectId: true },
    });
  });

  it.each([
    ['raid', 'raidItem'],
    ['automationTemplate', 'issueTemplate'],
    ['customField', 'customField'],
    ['repository', 'codeRepository'],
  ] as const)(
    '%s: tài nguyên cấp organization, projectId có thể null (không phải NotFound)',
    async (kind, model) => {
      const { svc, prisma } = setup();
      prisma[model].findFirst.mockResolvedValueOnce({ projectId: 'P4' });
      await expect(svc.resolveProjectId('W1', kind, 'X1')).resolves.toEqual({ projectId: 'P4' });
      expect(prisma[model].findFirst).toHaveBeenCalledWith({
        where: { id: 'X1', organizationId: 'W1' },
        select: { projectId: true },
      });
      prisma[model].findFirst.mockResolvedValueOnce({ projectId: null });
      await expect(svc.resolveProjectId('W1', kind, 'X2')).resolves.toEqual({ projectId: null });
      prisma[model].findFirst.mockResolvedValueOnce(null);
      await expect(svc.resolveProjectId('W1', kind, 'X3')).resolves.toBeNull();
    },
  );

  it.each([
    ['objective', 'objective'],
    ['slaPolicy', 'slaPolicy'],
  ] as const)(
    '%s: luôn thuộc một dự án — projectId lấy từ HÀNG (lọc theo organization), không có hàng → null',
    async (kind, model) => {
      const { svc, prisma } = setup();
      prisma[model].findFirst.mockResolvedValueOnce({ projectId: 'P7' });
      await expect(svc.resolveProjectId('W1', kind, 'X1')).resolves.toEqual({ projectId: 'P7' });
      expect(prisma[model].findFirst).toHaveBeenCalledWith({
        where: { id: 'X1', organizationId: 'W1' },
        select: { projectId: true },
      });
      prisma[model].findFirst.mockResolvedValueOnce(null);
      await expect(svc.resolveProjectId('W1', kind, 'X2')).resolves.toBeNull();
    },
  );

  it('recurringIssue: lọc qua project.organizationId', async () => {
    const { svc, prisma } = setup();
    prisma.recurringIssue.findFirst.mockResolvedValue({ projectId: 'P5' });
    await expect(svc.resolveProjectId('W1', 'recurringIssue', 'R1')).resolves.toEqual({
      projectId: 'P5',
    });
    expect(prisma.recurringIssue.findFirst).toHaveBeenCalledWith({
      where: { id: 'R1', project: { organizationId: 'W1', deletedAt: null } },
      select: { projectId: true },
    });
  });

  it('projectKey: tra dự án theo { key, organizationId } (key viết hoa), trả id dự án', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValueOnce({ id: 'P6' });
    await expect(svc.resolveProjectId('W1', 'projectKey', 'abc')).resolves.toEqual({
      projectId: 'P6',
    });
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { key: 'ABC', organizationId: 'W1' },
      select: { id: true },
    });
    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resolveProjectId('W1', 'projectKey', 'zzz')).resolves.toBeNull();
  });

  it('không tìm thấy -> null', async () => {
    const { svc, prisma } = setup();
    prisma.issue.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'issue', 'I-x')).resolves.toBeNull();
  });
});

describe('RbacService.assertProjectInOrganization', () => {
  it('NotFound khi dự án không thuộc organization', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(svc.assertProjectInOrganization('P1', 'W1')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'P1', organizationId: 'W1', deletedAt: null },
      select: { id: true },
    });
  });

  it('qua khi thuộc organization', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue({ id: 'P1' });
    await expect(svc.assertProjectInOrganization('P1', 'W1')).resolves.toBeUndefined();
  });
});

describe('RbacService.getEffectivePermissions', () => {
  it('membership dự án chỉ tính khi dự án thuộc organization', async () => {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValueOnce({
      roleId: 'R1',
      roles: [],
    } as never);
    await svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(prisma.projectMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_userId: { projectId: 'P1', userId: 'U1' },
          project: { organizationId: 'W1' },
        },
      }),
    );
  });

  it('rỗng khi không còn membership organization, kể cả khi còn ghi đè vai trò dự án', async () => {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValue(null);
    prisma.projectMembership.findUnique.mockResolvedValue({
      roleId: 'RP',
      roles: [{ roleId: 'RP' }],
    } as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'issue:edit' } },
    ] as never);
    const perms = await svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(perms.size).toBe(0);
    expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();
  });
});

describe('RbacService.resolveProjectId — tài nguyên của dự án đã xoá mềm', () => {
  it.each([
    ['comment', 'comment'],
    ['worklog', 'workLog'],
  ] as const)(
    '%s: issue cha của dự án đã xoá mềm bị loại (where có project.deletedAt:null)',
    async (kind, model) => {
      const { svc, prisma } = setup();
      prisma[model].findFirst.mockResolvedValue(null);
      await expect(svc.resolveProjectId('W1', kind, 'X1')).resolves.toBeNull();
      expect(prisma[model].findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'X1', issue: { organizationId: 'W1', project: { deletedAt: null } } },
        }),
      );
    },
  );

  it('attachment: cả đường issue lẫn đường comment->issue đều loại dự án đã xoá mềm', async () => {
    const { svc, prisma } = setup();
    prisma.attachment.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'attachment', 'A1')).resolves.toBeNull();
    const live = { organizationId: 'W1', project: { deletedAt: null } };
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'A1', OR: [{ issue: live }, { comment: { issue: live } }] },
      }),
    );
  });

  it('issueLink: link có đầu ở dự án đã xoá mềm bị loại (where đòi cả hai đầu project.deletedAt:null)', async () => {
    const { svc, prisma } = setup();
    prisma.issueLink.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'issueLink', 'L1')).resolves.toBeNull();
    const where = (prisma.issueLink.findFirst.mock.calls[0] as unknown as [{ where: object }])[0]
      .where;
    expect(where).toMatchObject({
      source: { project: { deletedAt: null } },
      target: { project: { deletedAt: null } },
    });
  });
});

describe('RbacService.resolveProjectId — wikiPage (A8)', () => {
  it('lọc theo organization; projectId null = tài liệu chung; không thấy → null', async () => {
    const { svc, prisma } = setup();
    prisma.wikiPage.findFirst.mockResolvedValueOnce({ projectId: 'P4' });
    await expect(svc.resolveProjectId('W1', 'wikiPage', 'X1')).resolves.toEqual({
      projectId: 'P4',
    });
    expect(prisma.wikiPage.findFirst).toHaveBeenCalledWith({
      // Trang của dự án đã xoá mềm = không tồn tại (guard 404)
      where: {
        id: 'X1',
        organizationId: 'W1',
        OR: [{ projectId: null }, { project: { deletedAt: null } }],
      },
      select: { projectId: true },
    });
    prisma.wikiPage.findFirst.mockResolvedValueOnce({ projectId: null });
    await expect(svc.resolveProjectId('W1', 'wikiPage', 'X2')).resolves.toEqual({
      projectId: null,
    });
    prisma.wikiPage.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resolveProjectId('W1', 'wikiPage', 'X3')).resolves.toBeNull();
  });
});

describe('RbacService — dự án riêng tư', () => {
  function privateSetup(opts: { isPrivate: boolean; member?: boolean; perm: string }) {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'r',
      roles: [{ role: { id: 'r', name: 'Organization Member' } }],
    } as never);
    prisma.projectMembership.findUnique.mockResolvedValue(
      opts.member ? ({ roleId: 'rp', roles: [{ roleId: 'rp' }] } as never) : null,
    );
    prisma.project.findFirst.mockResolvedValue({ isPrivate: opts.isPrivate });
    prisma.role.findMany.mockResolvedValue([{ id: 'rd' }] as never);
    prisma.rolePermission.findMany.mockResolvedValue([{ permission: { key: opts.perm } }] as never);
    return { svc, prisma };
  }

  it('compute: dự án riêng tư + không thành viên + không organization:admin => tập quyền RỖNG', async () => {
    const { svc } = privateSetup({ isPrivate: true, perm: 'issue:edit' });
    expect((await svc.getEffectivePermissions('U1', 'W1', 'P1')).size).toBe(0);
  });

  it('compute: có organization:admin => giữ nguyên quyền', async () => {
    const { svc } = privateSetup({ isPrivate: true, perm: 'organization:admin' });
    expect((await svc.getEffectivePermissions('U1', 'W1', 'P1')).has('organization:admin')).toBe(
      true,
    );
  });

  it('compute: là thành viên dự án riêng tư => quyền bình thường; dự án công khai => bình thường', async () => {
    const m = privateSetup({ isPrivate: true, member: true, perm: 'issue:edit' });
    expect((await m.svc.getEffectivePermissions('U1', 'W1', 'P1')).has('issue:edit')).toBe(true);
    const pub = privateSetup({ isPrivate: false, perm: 'issue:edit' });
    expect((await pub.svc.getEffectivePermissions('U1', 'W1', 'P1')).has('issue:edit')).toBe(true);
  });

  it('compute: tra isPrivate chỉ khi không có membership dự án; luôn lọc deletedAt + organization', async () => {
    const m = privateSetup({ isPrivate: true, member: true, perm: 'issue:edit' });
    await m.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(m.prisma.project.findFirst).not.toHaveBeenCalled();
    const n = privateSetup({ isPrivate: true, perm: 'issue:edit' });
    await n.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(n.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'P1', organizationId: 'W1', deletedAt: null } }),
    );
  });

  describe('assertProjectVisible', () => {
    function withRow(row: unknown, perms: string[] = ['project:view'], sysAdmin = false) {
      const ctx = setup('down');
      (ctx.prisma as Record<string, unknown>).user = {
        findUnique: vi.fn(() => Promise.resolve({ isSystemAdmin: sysAdmin })),
      };
      ctx.prisma.project.findFirst.mockResolvedValue(row);
      ctx.prisma.organizationMembership.findUnique.mockResolvedValue({
        roleId: 'r',
        roles: [{ role: { id: 'r', name: 'Organization Member' } }],
      } as never);
      ctx.prisma.rolePermission.findMany.mockResolvedValue(
        perms.map((key) => ({ permission: { key } })) as never,
      );
      return ctx;
    }

    it('dự án công khai + vai có project:view => qua', async () => {
      const { svc, prisma } = withRow({ isPrivate: false, memberships: [] });
      await expect(svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
      expect(prisma.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'P1', organizationId: 'W1', deletedAt: null } }),
      );
    });

    it('dự án không tồn tại/đã xoá/khác organization => 404 với người thường (nhất quán visibleWhere); admin vẫn qua', async () => {
      const { svc } = withRow(null);
      await expect(svc.assertProjectVisible('U1', 'W1', 'P1')).rejects.toBeInstanceOf(
        NotFoundAppException,
      );
      const admin = withRow(null, ['organization:admin']);
      await expect(admin.svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
    });

    it('riêng tư + là thành viên => qua', async () => {
      const { svc } = withRow({ isPrivate: true, memberships: [{ id: 'pm' }] });
      await expect(svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
    });

    it('riêng tư + không thành viên + không admin => 404 "Dự án" (đúng nhãn truyền vào)', async () => {
      const { svc } = withRow({ isPrivate: true, memberships: [] });
      await expect(svc.assertProjectVisible('U1', 'W1', 'P1')).rejects.toBeInstanceOf(
        NotFoundAppException,
      );
      await expect(svc.assertProjectVisible('U1', 'W1', 'P1', 'Tài nguyên')).rejects.toThrow(
        'Tài nguyên không tồn tại',
      );
    });

    it('riêng tư + không thành viên + organization:admin => qua; Quản trị => qua không cần tra dự án', async () => {
      const a = withRow({ isPrivate: true, memberships: [] }, ['organization:admin']);
      await expect(a.svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
      const s = withRow({ isPrivate: true, memberships: [] }, [], true);
      await expect(s.svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
      expect(s.prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('vai không có project:view: dự án công khai mình không là thành viên cũng 404; là thành viên thì qua', async () => {
      const no = withRow({ isPrivate: false, memberships: [] }, ['organization:view']);
      await expect(no.svc.assertProjectVisible('U1', 'W1', 'P1')).rejects.toBeInstanceOf(
        NotFoundAppException,
      );
      const yes = withRow({ isPrivate: false, memberships: [{ id: 'pm' }] }, ['organization:view']);
      await expect(yes.svc.assertProjectVisible('U1', 'W1', 'P1')).resolves.toBeUndefined();
    });

    it('knownSystemAdmin=false: không truy vấn user (guard đã biết)', async () => {
      const { svc, prisma } = withRow({ isPrivate: false, memberships: [] });
      await svc.assertProjectVisible('U1', 'W1', 'P1', 'Dự án', false);
      expect(
        (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique,
      ).not.toHaveBeenCalled();
    });
  });
});

describe('RbacService — P-C14: holdsOrganizationAdmin / adminRoleIds', () => {
  it('Quản trị → true, không cần tính quyền organization', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ isSystemAdmin: true });
    const spy = vi.spyOn(svc, 'getEffectivePermissions');
    await expect(svc.holdsOrganizationAdmin('U1', 'W1')).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
  it('quyền hiệu lực của organization có organization:admin → true', async () => {
    const { svc } = setup();
    vi.spyOn(svc, 'getEffectivePermissions').mockResolvedValue(new Set(['organization:admin']));
    await expect(svc.holdsOrganizationAdmin('U1', 'W1')).resolves.toBe(true);
  });
  it('chỉ có member:manage (không có organization:admin) → false; người không tồn tại → false', async () => {
    const { svc, prisma } = setup();
    vi.spyOn(svc, 'getEffectivePermissions').mockResolvedValue(new Set(['member:manage']));
    await expect(svc.holdsOrganizationAdmin('U1', 'W1')).resolves.toBe(false);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.holdsOrganizationAdmin('U1', 'W1')).resolves.toBe(false);
  });
  it('adminRoleIds: lọc theo quyền organization:admin; danh sách rỗng không chạm DB', async () => {
    const { svc, prisma } = setup();
    prisma.role.findMany.mockResolvedValue([{ id: 'r2' }] as never);
    const set = await svc.adminRoleIds(['r1', 'r2', 'r1']);
    expect([...set]).toEqual(['r2']);
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['r1', 'r2'] },
        permissions: { some: { permission: { key: 'organization:admin' } } },
      },
      select: { id: true },
    });
    prisma.role.findMany.mockClear();
    expect((await svc.adminRoleIds([])).size).toBe(0);
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });
});

describe('RbacService — tư cách thành viên chỉ do team (gắn team không làm giảm quyền)', () => {
  function teamSetup(opts: {
    isPrivate: boolean;
    roles: Array<{ roleId: string; direct?: boolean }>;
  }) {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'r',
      roles: [{ role: { id: 'r', name: 'Organization Admin' } }], // có vai trò dự án MẶC ĐỊNH (Project Admin)
    } as never);
    prisma.projectMembership.findUnique.mockResolvedValue({
      roleId: opts.roles[0]!.roleId,
      roles: opts.roles,
    } as never);
    prisma.project.findFirst.mockResolvedValue({ isPrivate: opts.isPrivate });
    prisma.role.findMany.mockResolvedValue([{ id: 'rdev' }] as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'issue:edit' } },
    ] as never);
    const roleIdsQueried = () =>
      (
        prisma.rolePermission.findMany.mock.calls as unknown as Array<
          [{ where: { roleId: { in: string[] } } }]
        >
      )[0]![0].where.roleId.in;
    return { svc, prisma, roleIdsQueried };
  }

  it('dự án công khai + mọi vai trò nhờ team (direct=false): cộng vai trò mặc định theo tổ chức', async () => {
    const t = teamSetup({ isPrivate: false, roles: [{ roleId: 'rrep', direct: false }] });
    await t.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(t.roleIdsQueried()).toEqual(expect.arrayContaining(['rrep', 'rdev']));
  });

  it('dự án riêng tư + chỉ nhờ team: KHÔNG cộng mặc định (chỉ vai trò team)', async () => {
    const t = teamSetup({ isPrivate: true, roles: [{ roleId: 'rrep', direct: false }] });
    await t.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(t.roleIdsQueried()).toContain('rrep');
    expect(t.roleIdsQueried()).not.toContain('rdev');
  });

  it('ghi đè tường minh (có vai trò gán trực tiếp) hoặc thành viên cũ chưa có dòng nối: giữ nghĩa "thay thế"', async () => {
    const a = teamSetup({
      isPrivate: false,
      roles: [
        { roleId: 'rrep', direct: false },
        { roleId: 'rx', direct: true },
      ],
    });
    await a.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(a.roleIdsQueried()).not.toContain('rdev');
    const b = teamSetup({ isPrivate: false, roles: [{ roleId: 'rleg' }] });
    b.prisma.projectMembership.findUnique.mockResolvedValue({ roleId: 'rleg', roles: [] } as never);
    await b.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(b.roleIdsQueried()).toContain('rleg');
    expect(b.roleIdsQueried()).not.toContain('rdev');
  });

  it('Người xem tổ chức (không có vai trò dự án mặc định) + vai trò nhờ team: chỉ có vai trò của team', async () => {
    const t = teamSetup({ isPrivate: false, roles: [{ roleId: 'rrep', direct: false }] });
    t.prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'rv',
      roles: [{ role: { id: 'rv', name: 'Organization Viewer' } }],
    } as never);
    await t.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(t.roleIdsQueried()).toContain('rrep');
    expect(t.roleIdsQueried()).not.toContain('rdev');
    expect(t.prisma.role.findMany).not.toHaveBeenCalled(); // không có vai trò mặc định để tra
  });

  it('không còn là thành viên tổ chức: vai trò nhờ team ở dự án cũng không cho quyền nào', async () => {
    const t = teamSetup({ isPrivate: false, roles: [{ roleId: 'rrep', direct: false }] });
    t.prisma.organizationMembership.findUnique.mockResolvedValue(null);
    const perms = await t.svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(perms.size).toBe(0);
    expect(t.prisma.rolePermission.findMany).not.toHaveBeenCalled();
  });
});

describe('RbacService.compute — vai trò riêng của dự án chỉ hiệu lực ở đúng dự án đó', () => {
  const run = async (projectId: string | null) => {
    const { svc, prisma, client } = setup();
    client.set.mockReturnValue(Promise.resolve('OK'));
    prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'orgRole',
      roles: [{ role: { id: 'orgRole', name: 'Organization Member' } }],
    } as never);
    prisma.project.findFirst.mockResolvedValue({ isPrivate: false });
    prisma.projectMembership.findUnique.mockResolvedValue({
      roleId: 'own',
      roles: [{ roleId: 'own', direct: true }],
    } as never);
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'issue:create' } },
    ] as never);
    await svc.getEffectivePermissions('U1', 'W1', projectId);
    return prisma;
  };

  it('tính ở một dự án: chỉ nhận vai trò mẫu hoặc vai trò riêng của CHÍNH dự án đó', async () => {
    const prisma = await run('P1');
    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { OR: [{ projectId: null }, { projectId: 'P1' }] },
        }) as object,
      }),
    );
  });

  it('tính cấp tổ chức (không dự án): không nhận vai trò riêng của dự án nào', async () => {
    const prisma = await run(null);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: { projectId: null } }) as object,
      }),
    );
  });
});

describe('RbacService — dự án công khai chỉ xem với Organization Member', () => {
  it('Organization Member không còn vai trò dự án mặc định: không có dòng thành viên → chỉ quyền của vai trò tổ chức (không tra vai trò dự án mặc định)', async () => {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'r',
      roles: [{ role: { id: 'r', name: 'Organization Member' } }],
    } as never);
    prisma.projectMembership.findUnique.mockResolvedValue(null);
    prisma.project.findFirst.mockResolvedValue({ isPrivate: false });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'project:view' } },
    ] as never);
    const perms = await svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect([...perms]).toEqual(['project:view']);
    expect(prisma.role.findMany).not.toHaveBeenCalled(); // không có vai trò mặc định để tra
    const asked = (
      prisma.rolePermission.findMany.mock.calls as unknown as Array<
        [{ where: { roleId: { in: string[] } } }]
      >
    )[0]![0].where.roleId.in;
    expect([...new Set(asked)]).toEqual(['r']);
  });

  it('Organization Admin vẫn có Project Admin mặc định ở dự án công khai', async () => {
    const { svc, prisma } = setup('down');
    prisma.organizationMembership.findUnique.mockResolvedValue({
      roleId: 'a',
      roles: [{ role: { id: 'a', name: 'Organization Admin' } }],
    } as never);
    prisma.projectMembership.findUnique.mockResolvedValue(null);
    prisma.project.findFirst.mockResolvedValue({ isPrivate: false });
    prisma.role.findMany.mockResolvedValue([{ id: 'rpa' }] as never);
    prisma.rolePermission.findMany.mockResolvedValue([] as never);
    await svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { in: ['Project Admin'] },
          projectId: null,
        }) as object,
      }),
    );
  });
});
