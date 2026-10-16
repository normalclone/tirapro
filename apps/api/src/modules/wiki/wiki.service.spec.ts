import { describe, expect, it, vi } from 'vitest';
import { WikiService } from './wiki.service';
import { restoreWikiVersionSchema, updateWikiPageSchema } from './wiki.schemas';

describe('WikiService.search — escape ký tự đại diện LIKE', () => {
  it('q="_" / "50%" được escape (không khớp mọi trang), tìm cả title và body', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new WikiService({ wikiPage: { findMany } } as never, {} as never, {} as never);
    await service.search('w1', '_');
    await service.search('w1', '50%');
    const calls = findMany.mock.calls as unknown as Array<[{ where: { OR: unknown[] } }]>;
    expect(calls[0]![0].where.OR).toEqual([
      { title: { contains: '\\_', mode: 'insensitive' } },
      { body: { contains: '\\_', mode: 'insensitive' } },
    ]);
    expect(JSON.stringify(calls[1]![0].where.OR)).toContain('"contains":"50\\\\%"');
  });
});

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

const U = { id: 'u1' };

type Member = { user: { id: string; displayName: string } };

function setup(archived: boolean, pageProjectId: string | null = 'p1') {
  const archivedAt = archived ? new Date() : null;
  const page = {
    id: 'g1',
    workspaceId: 'w1',
    projectId: pageProjectId,
    parentId: null,
    title: 'T',
    body: '',
    order: 0,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    project: {
      findMany: vi.fn((): Promise<{ id: string }[]> => Promise.resolve([{ id: 'p1' }])),
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1', archivedAt })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt })),
    },
    wikiPage: {
      findFirst: vi.fn((..._args: unknown[]) => Promise.resolve(page)),
      findMany: vi.fn((..._args: unknown[]): Promise<unknown[]> => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 'g2' })),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      aggregate: vi.fn(() => Promise.resolve({ _max: { order: null } })),
    },
    wikiPageVersion: {
      findFirst: vi.fn((): Promise<unknown> => Promise.resolve(null)),
      findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    user: { findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])) },
    $queryRaw: vi.fn((..._a: unknown[]): Promise<unknown[]> => Promise.resolve([])),
    issue: { findMany: vi.fn((): Promise<{ id: string }[]> => Promise.resolve([])) },
    wikiPageIssue: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
    },
    workspaceMembership: { findMany: vi.fn((): Promise<Member[]> => Promise.resolve([])) },
    projectMembership: { findMany: vi.fn((): Promise<Member[]> => Promise.resolve([])) },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve([]),
    ),
  };
  // Mặc định: người đọc có project:view cấp workspace (thấy mọi dự án).
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(['project:view']))) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  return {
    service: new WikiService(prisma as never, rbac as never, audit as never),
    prisma,
    rbac,
    audit,
  };
}

describe('WikiService — dự án lưu trữ là chỉ đọc', () => {
  it('create/update/move/remove trang của dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', { title: 'Trang', projectId: 'p1' } as never, U),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.create('w1', { title: 'Con', parentId: 'g1' } as never, U),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.update('w1', 'g1', { title: 'Mới' }, U)).rejects.toMatchObject(ARCHIVED);
    await expect(service.move('w1', 'g1', { order: 0 })).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'g1', U)).rejects.toMatchObject(ARCHIVED);
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
    expect(prisma.wikiPage.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trang chung của workspace vẫn xoá được', async () => {
    const { service, prisma } = setup(true, null);
    await service.remove('w1', 'g1', U);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('WikiService.create — phạm vi trang con khớp trang cha (A8)', () => {
  it('parentId thuộc dự án khác body.projectId → 422, không ghi (chặn leo thang đặc quyền)', async () => {
    const { service, prisma } = setup(false, 'pQ'); // trang cha thuộc dự án pQ
    await expect(
      service.create('w1', { title: 'x', body: '', projectId: 'pP', parentId: 'g1' }, U),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
  });

  it('trang cha chung (null) nhưng body.projectId có giá trị → 422', async () => {
    const { service, prisma } = setup(false, null);
    await expect(
      service.create('w1', { title: 'x', body: '', projectId: 'pP', parentId: 'g1' }, U),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.wikiPage.create).not.toHaveBeenCalled();
  });

  it('parentId + cùng projectId → tạo được', async () => {
    const { service, prisma } = setup(false, 'pQ');
    await service.create('w1', { title: 'x', body: '', projectId: 'pQ', parentId: 'g1' }, U);
    expect(prisma.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: 'pQ', parentId: 'g1' }) as unknown,
      }),
    );
  });

  it('parentId + cùng null (trang chung) → tạo được', async () => {
    const { service, prisma } = setup(false, null);
    await service.create('w1', { title: 'x', body: '', parentId: 'g1' }, U);
    expect(prisma.wikiPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: null, parentId: 'g1' }) as unknown,
      }),
    );
  });
});

describe('WikiService.admins — "xin ai" cấp quyền / xoá trang (A9)', () => {
  const user = (id: string, displayName: string) => ({ user: { id, displayName } });

  it('gộp quản trị workspace + dự án, khử trùng, sắp theo tên', async () => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce([user('a', 'An')]);
    prisma.projectMembership.findMany.mockResolvedValueOnce([user('b', 'Bình'), user('a', 'An')]);
    await expect(service.admins('w1', 'p1')).resolves.toEqual([
      { id: 'a', displayName: 'An' },
      { id: 'b', displayName: 'Bình' },
    ]);
    const has = {
      permissions: { some: { permission: { key: 'project:admin' } } },
    };
    const active = { status: { not: 'DEACTIVATED' } };
    expect(prisma.workspaceMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          user: active,
          OR: [{ role: has }, { roles: { some: { role: has } } }],
        },
        take: 8,
      }),
    );
    expect(prisma.projectMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'p1',
          user: active,
          OR: [{ role: has }, { roles: { some: { role: has } } }],
        },
      }),
    );
  });

  it.each([undefined, 'none'])('projectId=%s → chỉ hỏi quản trị workspace', async (projectId) => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce([user('a', 'An')]);
    await expect(service.admins('w1', projectId)).resolves.toEqual([
      { id: 'a', displayName: 'An' },
    ]);
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
  });

  it('tối đa 8 người sau khi gộp', async () => {
    const { service, prisma } = setup(false);
    prisma.workspaceMembership.findMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => user(`w${i}`, `Ws ${i}`)),
    );
    prisma.projectMembership.findMany.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => user(`p${i}`, `Pr ${i}`)),
    );
    expect(await service.admins('w1', 'p1')).toHaveLength(8);
  });
});

describe('WikiService.update — chống ghi đè theo version nội dung (A10)', () => {
  it('expectedVersion lệch → VersionConflictException (409), không ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.update('w1', 'g1', { body: 'mới', expectedVersion: 3 }, U),
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
  });

  it('trang vừa bị xoá giữa chừng → 404 (không phải 409)', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    // lần 1 (requireWritablePage) thấy trang; lần 2 (phân biệt sau khi count=0) không còn
    prisma.wikiPage.findFirst.mockResolvedValueOnce({
      id: 'g1',
      projectId: 'p1',
      parentId: null,
      title: 'T',
      order: 0,
      updatedAt: new Date(),
    } as never);
    prisma.wikiPage.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.update('w1', 'g1', { body: 'mới', expectedVersion: 0 }, U),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('khớp → updateMany có where.version đúng và tăng version', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.update('w1', 'g1', { body: 'mới', expectedVersion: 3 }, U);
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1', workspaceId: 'w1', deletedAt: null, version: 3 },
        data: expect.objectContaining({
          body: 'mới',
          updatedById: 'u1',
          version: { increment: 1 },
        }) as unknown,
      }),
    );
  });

  it('không gửi expectedVersion → ghi không kiểm version (vẫn tăng version, tương thích client cũ) nhưng vẫn lọc deletedAt', async () => {
    const { service, prisma } = setup(false);
    await service.update('w1', 'g1', { body: 'mới' }, U);
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1', workspaceId: 'w1', deletedAt: null },
        data: expect.objectContaining({ version: { increment: 1 } }) as unknown,
      }),
    );
  });

  it('không OCC + trang vừa bị xoá mềm trong khe đua (count 0) → 404, không chụp phiên bản', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.wikiPage.findFirst
      .mockResolvedValueOnce({
        id: 'g1',
        projectId: 'p1',
        parentId: null,
        title: 'T',
        order: 0,
      } as never)
      .mockResolvedValueOnce(null as never);
    await expect(service.update('w1', 'g1', { body: 'mới' }, U)).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });

  it('schema: expectedVersion phải là số nguyên không âm', () => {
    expect(updateWikiPageSchema.safeParse({ body: 'x', expectedVersion: 'a' }).success).toBe(false);
    expect(updateWikiPageSchema.safeParse({ body: 'x', expectedVersion: -1 }).success).toBe(false);
    expect(updateWikiPageSchema.safeParse({ body: 'x', expectedVersion: 2 }).success).toBe(true);
  });
});

describe('WikiService.move/remove — không làm đổi version/updatedAt của trang không đổi (A10)', () => {
  const T0 = new Date('2026-10-01T00:00:00Z');
  const row = (id: string, order: number) => ({ id, order, updatedAt: T0 });

  it('đổi chỗ chỉ ghi hàng có order đổi, giữ updatedAt, không ghi version/updatedById', async () => {
    const { service, prisma } = setup(false);
    // trang g1 (order 0) chuyển xuống cuối cùng nhóm [a0, b1, c2] → a, b, c dịch lên 1... chỉ g1 và các hàng lệch bị ghi
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: 'g1',
      projectId: 'p1',
      parentId: null,
      title: 'T',
      order: 0,
      updatedAt: T0,
    } as never);
    prisma.wikiPage.findMany.mockResolvedValueOnce([row('a', 1), row('b', 2), row('c', 3)]);
    await service.move('w1', 'g1', { order: 3 });
    const updates = prisma.wikiPage.update.mock.calls.map(
      (c) => (c as unknown as [{ where: { id: string }; data: Record<string, unknown> }])[0],
    );
    // a→0, b→1, c→2, g1→3: cả bốn đổi vị trí
    expect(updates.map((u) => u.where.id).sort()).toEqual(['a', 'b', 'c', 'g1']);
    for (const u of updates) {
      expect(u.data).not.toHaveProperty('version');
      expect(u.data).not.toHaveProperty('updatedById');
      expect(u.data.updatedAt).toBe(T0);
    }
  });

  it('anh em đứng yên (order không đổi) thì KHÔNG bị ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValue({
      id: 'g1',
      projectId: 'p1',
      parentId: null,
      title: 'T',
      order: 2,
      updatedAt: T0,
    } as never);
    // [a0, b1] đứng yên; g1 chuyển từ order 2 sang cuối (order 2) → không có gì đổi
    prisma.wikiPage.findMany.mockResolvedValueOnce([row('a', 0), row('b', 1)]);
    await service.move('w1', 'g1', { order: 2 });
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('xoá trang: nhóm đã liên tục thì renumber không ghi hàng nào', async () => {
    const { service, prisma } = setup(false, null);
    prisma.wikiPage.findMany
      .mockResolvedValueOnce([]) // không có trang con
      .mockResolvedValueOnce([row('a', 0), row('b', 1)]); // renumber nhóm anh em
    await service.remove('w1', 'g1', U);
    // chỉ MỘT lần ghi: đánh dấu xoá mềm; anh em đã liên tục nên không bị ghi
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledTimes(1); // chỉ đánh dấu xoá mềm
    expect(prisma.wikiPage.update).not.toHaveBeenCalled(); // anh em đã liên tục + không con
  });
});

describe('WikiService — liên kết trang ↔ công việc (A11)', () => {
  it('update(): đồng bộ liên kết từ mã công việc trong body, bỏ mã không tồn tại', async () => {
    const { service, prisma } = setup(false);
    prisma.issue.findMany.mockResolvedValueOnce([{ id: 'i1' }]); // chỉ DEMO-STORY-3 có thật
    await service.update('w1', 'g1', { body: 'Xem DEMO-STORY-3 và UTF-8' }, U);
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'w1',
          key: { in: ['DEMO-STORY-3', 'UTF-8'] },
          deletedAt: null,
          project: { deletedAt: null },
        }) as unknown,
      }),
    );
    expect(prisma.wikiPageIssue.deleteMany).toHaveBeenCalledWith({ where: { wikiPageId: 'g1' } });
    expect(prisma.wikiPageIssue.createMany).toHaveBeenCalledWith({
      data: [{ wikiPageId: 'g1', issueId: 'i1' }],
      skipDuplicates: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2); // ghi trang + chụp phiên bản; đồng bộ liên kết
  });

  it('create(): trang mới có body nhắc mã → ghi liên kết cho trang vừa tạo', async () => {
    const { service, prisma } = setup(false);
    prisma.issue.findMany.mockResolvedValueOnce([{ id: 'i1' }]);
    await service.create('w1', { title: 'x', body: 'Liên quan DEMO-3', projectId: 'p1' }, U);
    expect(prisma.wikiPageIssue.createMany).toHaveBeenCalledWith({
      data: [{ wikiPageId: 'g2', issueId: 'i1' }],
      skipDuplicates: true,
    });
  });

  it('update(): chỉ đổi tiêu đề (không có body) → không đụng liên kết', async () => {
    const { service, prisma } = setup(false);
    await service.update('w1', 'g1', { title: 'Tên mới' }, U);
    expect(prisma.wikiPageIssue.deleteMany).not.toHaveBeenCalled();
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('update(): body không còn mã → xoá hết liên kết, không truy vấn issue, không createMany', async () => {
    const { service, prisma } = setup(false);
    await service.update('w1', 'g1', { body: 'Không còn mã nào' }, U);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.wikiPageIssue.deleteMany).toHaveBeenCalledWith({ where: { wikiPageId: 'g1' } });
    expect(prisma.wikiPageIssue.createMany).not.toHaveBeenCalled();
  });

  it('update(): đồng bộ liên kết lỗi → trang vẫn lưu và trả về bình thường (chỉ log)', async () => {
    const { service, prisma } = setup(false);
    prisma.issue.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(service.update('w1', 'g1', { body: 'DEMO-3' }, U)).resolves.toMatchObject({
      id: 'g1',
    });
    expect(prisma.wikiPage.updateMany).toHaveBeenCalled();
  });

  it('get(): trả issues của công việc còn sống (lọc deletedAt công việc + dự án)', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageIssue.findMany.mockResolvedValueOnce([
      {
        issue: {
          id: 'i1',
          key: 'DEMO-3',
          summary: 'Đăng nhập',
          type: { name: 'Story' },
          status: { name: 'Đang làm', category: 'IN_PROGRESS' },
        },
      },
    ]);
    const page = await service.get('w1', 'g1', U);
    expect(page.issues).toEqual([
      {
        id: 'i1',
        key: 'DEMO-3',
        summary: 'Đăng nhập',
        typeName: 'Story',
        statusName: 'Đang làm',
        statusCategory: 'IN_PROGRESS',
      },
    ]);
    expect(prisma.wikiPageIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wikiPageId: 'g1', issue: { deletedAt: null, project: { deletedAt: null } } },
      }),
    );
  });

  it('byIssue(): lọc theo workspace + liên kết, kèm projectKey', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      {
        id: 'g1',
        title: 'Đặc tả',
        projectId: 'p1',
        project: { key: 'DEMO' },
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        id: 'g9',
        title: 'Chung',
        projectId: null,
        project: null,
        updatedAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    await expect(service.byIssue('w1', 'i1', U)).resolves.toEqual([
      {
        id: 'g1',
        title: 'Đặc tả',
        projectId: 'p1',
        projectKey: 'DEMO',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'g9',
        title: 'Chung',
        projectId: null,
        projectKey: null,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          deletedAt: null,
          issues: { some: { issueId: 'i1' } },
          OR: [{ projectId: null }, { project: { deletedAt: null } }],
        },
      }),
    );
  });
});

describe('WikiService.visibleIssueFilter — lọc lúc đọc theo quyền xem (A11)', () => {
  it('có project:view cấp workspace → thấy mọi dự án còn sống (không tra từng dự án)', async () => {
    const { service, prisma } = setup(false);
    await expect(service.visibleIssueFilter({ id: 'u1' }, 'w1')).resolves.toEqual({
      deletedAt: null,
      project: { deletedAt: null },
    });
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('system admin → không hỏi quyền', async () => {
    const { service, rbac } = setup(false);
    await service.visibleIssueFilter({ id: 'u1', isSystemAdmin: true }, 'w1');
    expect(rbac.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('không có project:view ở workspace → dự án người đọc không xem được bị loại (notIn)', async () => {
    const { service, prisma, rbac } = setup(false);
    prisma.project.findMany.mockResolvedValueOnce([{ id: 'pA' }, { id: 'pB' }]);
    rbac.getEffectivePermissions.mockImplementation(((_u: string, _w: string, p?: string | null) =>
      Promise.resolve(new Set(p === 'pA' ? ['project:view'] : []))) as never);
    await expect(service.visibleIssueFilter({ id: 'u1' }, 'w1')).resolves.toEqual({
      deletedAt: null,
      project: { deletedAt: null, id: { notIn: ['pB'] } },
    });
  });

  it('get(): where của issues dùng bộ lọc quyền xem (công việc dự án ẩn không lộ)', async () => {
    const { service, prisma, rbac } = setup(false);
    prisma.project.findMany.mockResolvedValueOnce([{ id: 'pA' }]);
    rbac.getEffectivePermissions.mockImplementation(() => Promise.resolve(new Set([])));
    await service.get('w1', 'g1', U);
    expect(prisma.wikiPageIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          wikiPageId: 'g1',
          issue: { deletedAt: null, project: { deletedAt: null, id: { notIn: ['pA'] } } },
        },
      }),
    );
  });
});

describe('WikiService — chụp phiên bản khi lưu (A18)', () => {
  const lastOf = (version: number, title: string, body: string) => ({ version, title, body });

  it('create(): ghi phiên bản 1 (tiêu đề, nội dung, người tạo)', async () => {
    const { service, prisma } = setup(false, null);
    await service.create('w1', { title: 'Đặc tả', body: 'a' }, U);
    expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wikiPageId: 'g2',
        version: 1,
        title: 'Đặc tả',
        body: 'a',
        authorId: 'u1',
        note: null,
      }) as unknown,
    });
  });

  it('update(): nội dung đổi → phiên bản = bản mới nhất + 1', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastOf(3, 'T', 'cũ'));
    await service.update('w1', 'g1', { body: 'mới' }, { id: 'u2' });
    expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        wikiPageId: 'g1',
        version: 4,
        body: 'mới',
        authorId: 'u2',
      }) as unknown,
    });
  });

  it('update(): có OCC → vẫn chụp phiên bản; chỉ sửa tiêu đề thì lấy nội dung từ dòng vừa ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastOf(1, 'T', 'giữ nguyên'));
    // 1: requireWritablePage; 2: đọc nội dung sau khi ghi
    prisma.wikiPage.findFirst
      .mockResolvedValueOnce({
        id: 'g1',
        projectId: 'p1',
        parentId: null,
        title: 'T',
        order: 0,
      } as never)
      .mockResolvedValueOnce({ body: 'giữ nguyên' } as never);
    await service.update('w1', 'g1', { title: 'Mới', expectedVersion: 1 }, U);
    expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, title: 'Mới', body: 'giữ nguyên' }) as unknown,
    });
  });

  it('update(): tiêu đề và nội dung không đổi → KHÔNG tạo phiên bản', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.update.mockResolvedValueOnce({ title: 'T', body: 'x' });
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastOf(3, 'T', 'x'));
    await service.update('w1', 'g1', { title: 'T', body: 'x' }, U);
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });

  it('update(): xung đột OCC → không chụp phiên bản', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.update('w1', 'g1', { body: 'mới', expectedVersion: 9 }, U),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });

  it('update(): vượt 200 phiên bản → xoá bản cũ nhất', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastOf(205, 'T', 'cũ'));
    await service.update('w1', 'g1', { body: 'mới' }, { id: 'u2' });
    expect(prisma.wikiPageVersion.deleteMany).toHaveBeenCalledWith({
      where: { wikiPageId: 'g1', version: { lte: 206 - 200 } },
    });
  });

  it('move(): đổi chỗ KHÔNG tạo phiên bản', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findMany.mockResolvedValueOnce([{ id: 'a', order: 0, updatedAt: new Date() }]);
    await service.move('w1', 'g1', { order: 0 });
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });
});

describe('WikiService — xem/khôi phục phiên bản (A18)', () => {
  const lastOf = (version: number, title: string, body: string) => ({ version, title, body });

  it('listVersions(): mới nhất trước, không trả body, kèm tên người lưu', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findMany.mockResolvedValueOnce([
      {
        version: 2,
        title: 'T',
        authorId: 'u1',
        note: null,
        createdAt: new Date('2026-10-02T00:00:00Z'),
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ version: 2, size: 3 }]); // độ dài tính ở DB
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1', displayName: 'Bình' }]);
    const out = await service.listVersions('w1', 'g1', U);
    expect(out).toEqual([
      {
        version: 2,
        title: 'T',
        authorName: 'Bình',
        note: null,
        createdAt: '2026-10-02T00:00:00.000Z',
        size: 3,
      },
    ]);
    expect(prisma.wikiPageVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wikiPageId: 'g1' },
        orderBy: { version: 'desc' },
        take: 200,
        select: {
          version: true,
          title: true,
          authorId: true,
          note: true,
          createdAt: true,
        },
      }),
    );
    // KHÔNG đọc body để đo độ dài
    const sel = (
      prisma.wikiPageVersion.findMany.mock.calls[0] as unknown as [{ select: object }]
    )[0].select;
    expect(sel).not.toHaveProperty('body');
  });

  it('listVersions()/getVersion(): trang không có trong workspace → 404, không đọc lịch sử', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValue(null as never);
    await expect(service.listVersions('w1', 'g1', U)).rejects.toMatchObject({ status: 404 });
    await expect(service.getVersion('w1', 'g1', 1, U)).rejects.toMatchObject({ status: 404 });
    expect(prisma.wikiPageVersion.findMany).not.toHaveBeenCalled();
    expect(prisma.wikiPageVersion.findFirst).not.toHaveBeenCalled();
  });

  it('getVersion(): không có → NotFound; có → kèm nội dung', async () => {
    const { service, prisma } = setup(false);
    await expect(service.getVersion('w1', 'g1', 9, U)).rejects.toMatchObject({ status: 404 });
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce({
      version: 2,
      title: 'T',
      body: 'nội dung',
      authorId: null,
      note: 'ghi chú',
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    await expect(service.getVersion('w1', 'g1', 2, U)).resolves.toMatchObject({
      version: 2,
      body: 'nội dung',
      authorName: null,
      note: 'ghi chú',
    });
  });

  it('restoreVersion(): ghi lại tiêu đề/nội dung bản cũ, phiên bản mới có note, OCC bắt buộc', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findFirst
      .mockResolvedValueOnce(lastOf(2, 'Cũ', 'bản 2')) // bản cần khôi phục
      .mockResolvedValueOnce(lastOf(5, 'Mới', 'bản 5')); // bản mới nhất (trong snapshot)
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.restoreVersion('w1', 'g1', 2, { expectedVersion: 4 }, { id: 'u3' });
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'g1', workspaceId: 'w1', deletedAt: null, version: 4 },
        data: expect.objectContaining({
          title: 'Cũ',
          body: 'bản 2',
          updatedById: 'u3',
          version: { increment: 1 },
        }) as unknown,
      }),
    );
    expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 6,
        title: 'Cũ',
        body: 'bản 2',
        authorId: 'u3',
        note: 'Khôi phục từ phiên bản 2',
      }) as unknown,
    });
  });

  it('restoreVersion(): bản trùng nội dung bản mới nhất vẫn tạo phiên bản (có note)', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findFirst
      .mockResolvedValueOnce(lastOf(2, 'T', 'x'))
      .mockResolvedValueOnce(lastOf(5, 'T', 'x'));
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.restoreVersion('w1', 'g1', 2, { expectedVersion: 0 }, U);
    expect(prisma.wikiPageVersion.create).toHaveBeenCalledTimes(1);
  });

  it('restoreVersion(): trang đã đổi (updateMany count 0) → 409, không tạo phiên bản', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastOf(2, 'Cũ', 'bản 2'));
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.restoreVersion('w1', 'g1', 2, { expectedVersion: 1 }, U),
    ).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });

  it('restoreVersion(): phiên bản không tồn tại → 404, không ghi trang', async () => {
    const { service, prisma } = setup(false);
    await expect(
      service.restoreVersion('w1', 'g1', 99, { expectedVersion: 1 }, U),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.wikiPage.updateMany).not.toHaveBeenCalled();
  });

  it('restoreVersion(): dự án lưu trữ → 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.restoreVersion('w1', 'g1', 2, { expectedVersion: 1 }, U),
    ).rejects.toMatchObject(ARCHIVED);
    expect(prisma.wikiPage.updateMany).not.toHaveBeenCalled();
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });

  it('schema: restore bắt buộc expectedVersion nguyên không âm', () => {
    expect(restoreWikiVersionSchema.safeParse({}).success).toBe(false);
    expect(restoreWikiVersionSchema.safeParse({ expectedVersion: -1 }).success).toBe(false);
    expect(restoreWikiVersionSchema.safeParse({ expectedVersion: 0 }).success).toBe(true);
  });
});

describe('WikiService — xoá mềm trang, thùng rác, khôi phục (A20)', () => {
  const T0 = new Date('2026-10-01T00:00:00Z');

  it('remove(): xoá mềm — update deletedAt/deletedById, không gọi delete', async () => {
    const { service, prisma } = setup(false);
    await service.remove('w1', 'g1', { id: 'u9' });
    expect(prisma.wikiPage.delete).not.toHaveBeenCalled();
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', workspaceId: 'w1', deletedAt: null },
      data: { deletedAt: expect.any(Date) as unknown, deletedById: 'u9' },
    });
  });

  it('remove(): đã bị xoá trong khe đua (count 0) → 404, không nâng con, không audit', async () => {
    const { service, prisma, audit } = setup(false);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('w1', 'g1', U)).rejects.toMatchObject({ status: 404 });
    expect(prisma.wikiPage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('remove(): đọc/nâng con nằm TRONG giao dịch, sau khi đánh dấu xoá', async () => {
    const { service, prisma } = setup(false);
    const order: string[] = [];
    prisma.wikiPage.updateMany.mockImplementationOnce(() => {
      order.push('mark');
      return Promise.resolve({ count: 1 });
    });
    prisma.wikiPage.findMany.mockImplementationOnce(() => {
      order.push('children');
      return Promise.resolve([]);
    });
    await service.remove('w1', 'g1', U);
    expect(order).toEqual(['mark', 'children']);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('remove(): ghi nhật ký kiểm toán sau khi xoá', async () => {
    const { service, audit } = setup(false);
    await service.remove('w1', 'g1', { id: 'u9' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        actorId: 'u9',
        action: 'wiki.page_deleted',
        entityType: 'wikiPage',
        entityId: 'g1',
      }),
    );
  });

  it('remove(): con được nâng lên cha của trang xoá, GIỮ updatedAt (không bump) và chỉ lấy con còn sống', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      { id: 'c1', updatedAt: T0 },
      { id: 'c2', updatedAt: T0 },
    ]);
    await service.remove('w1', 'g1', { id: 'u9' });
    expect(prisma.wikiPage.findMany.mock.calls[0]![0]).toMatchObject({
      where: { workspaceId: 'w1', parentId: 'g1', deletedAt: null },
    });
    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { parentId: null, updatedAt: T0 },
    });
    expect(prisma.wikiPage.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { parentId: null, updatedAt: T0 },
    });
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledTimes(1); // chỉ đánh dấu xoá, con đi bằng update từng hàng
  });
});

describe('WikiService — đọc/khôi phục xoá mềm (A20)', () => {
  const T0 = new Date('2026-10-01T00:00:00Z');

  it('mọi truy vấn đọc wikiPage (tree/search/get/byIssue/move/update) đều có deletedAt: null', async () => {
    const { service, prisma } = setup(false);
    await service.tree('w1');
    await service.search('w1', 'ab');
    await service.get('w1', 'g1', { id: 'u1' });
    await service.byIssue('w1', 'i1', { id: 'u1' });
    await service.move('w1', 'g1', { order: 0 });
    await service.update('w1', 'g1', { body: 'x' }, U);
    const calls = [...prisma.wikiPage.findMany.mock.calls, ...prisma.wikiPage.findFirst.mock.calls];
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls as unknown as [{ where: unknown }][])
      expect(JSON.stringify(c[0].where)).toContain('"deletedAt":null');
  });

  it('get()/update(): trang đã xoá mềm (không còn qua bộ lọc) → 404', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValue(null as never);
    await expect(service.get('w1', 'g1', U)).rejects.toMatchObject({ status: 404 });
    await expect(service.update('w1', 'g1', { body: 'x' }, U)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('trash(): chỉ trang đã xoá của đúng phạm vi, kèm tên người xoá', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findMany.mockResolvedValueOnce([
      { id: 'g1', title: 'Cũ', projectId: 'p1', deletedAt: T0, deletedById: 'u7' },
      { id: 'g2', title: 'Mồ côi', projectId: 'p1', deletedAt: T0, deletedById: null },
    ]);
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u7', displayName: 'Lan' }]);
    const out = await service.trash('w1', 'p1', U);
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', deletedAt: { not: null }, projectId: 'p1' },
        orderBy: { deletedAt: 'desc' },
        take: 100,
      }),
    );
    expect(out).toEqual([
      {
        id: 'g1',
        title: 'Cũ',
        projectId: 'p1',
        deletedAt: '2026-10-01T00:00:00.000Z',
        deletedByName: 'Lan',
      },
      {
        id: 'g2',
        title: 'Mồ côi',
        projectId: 'p1',
        deletedAt: '2026-10-01T00:00:00.000Z',
        deletedByName: null,
      },
    ]);
  });

  it("trash('none'): chỉ tài liệu chung (projectId null)", async () => {
    const { service, prisma } = setup(false);
    await service.trash('w1', 'none', U);
    expect(prisma.wikiPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', deletedAt: { not: null }, projectId: null },
      }),
    );
  });

  it('undelete(): trang cha cũ còn sống → giữ cha, xếp cuối nhóm anh em, xoá dấu xoá mềm', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst
      .mockResolvedValueOnce({ id: 'g1', projectId: 'p1', parentId: 'par' } as never) // trang đã xoá
      .mockResolvedValueOnce({ id: 'par' } as never) // cha còn sống
      .mockResolvedValueOnce({ order: 4 } as never); // nextOrder: anh em cuối có order 4
    await service.undelete('w1', 'g1', U);
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', workspaceId: 'w1', deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, parentId: 'par', order: 5 },
    });
  });

  it('undelete(): trang cha cũ cũng đã xoá/không còn → lên gốc', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst
      .mockResolvedValueOnce({ id: 'g1', projectId: 'p1', parentId: 'par' } as never)
      .mockResolvedValueOnce(null as never); // cha đã xoá
    await service.undelete('w1', 'g1', U);
    expect(prisma.wikiPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deletedAt: null, parentId: null }) as unknown,
      }),
    );
    // cha được tìm với bộ lọc còn sống
    expect(prisma.wikiPage.findFirst.mock.calls[1]![0]).toMatchObject({
      where: { id: 'par', deletedAt: null },
    });
  });

  it('undelete(): trang chưa bị xoá (hoặc không tồn tại) → 404, không ghi', async () => {
    const { service, prisma } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.undelete('w1', 'g1', U)).rejects.toMatchObject({ status: 404 });
    expect(prisma.wikiPage.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'g1', workspaceId: 'w1', deletedAt: { not: null } },
    });
    expect(prisma.wikiPage.updateMany).not.toHaveBeenCalled();
  });

  it('undelete(): trang của dự án lưu trữ → 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    prisma.wikiPage.findFirst.mockResolvedValueOnce({
      id: 'g1',
      projectId: 'p1',
      parentId: null,
    } as never);
    await expect(service.undelete('w1', 'g1', U)).rejects.toMatchObject(ARCHIVED);
    expect(prisma.wikiPage.updateMany).not.toHaveBeenCalled();
  });

  it('xoá mềm giữ lịch sử: remove() không đụng wikiPageVersion', async () => {
    const { service, prisma } = setup(false);
    await service.remove('w1', 'g1', { id: 'u9' });
    expect(prisma.wikiPageVersion.deleteMany).not.toHaveBeenCalled();
    expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
  });
});

describe('WikiService — gộp phiên bản lần lưu liền nhau của cùng người (I-1)', () => {
  const NOW = new Date('2026-10-16T10:00:00Z');
  const last = (over: Record<string, unknown> = {}) => ({
    version: 3,
    title: 'T',
    body: 'cũ',
    authorId: 'u2',
    note: null,
    createdAt: new Date(NOW.getTime() - 3 * 60_000),
    ...over,
  });
  const save = async (lastRow: unknown, userId = 'u2') => {
    const ctx = setup(false);
    ctx.prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(lastRow);
    await ctx.service.update('w1', 'g1', { body: 'mới' }, { id: userId });
    return ctx;
  };

  it('cùng người, trong 10 phút → cập nhật phiên bản đó (không tạo mới, version giữ nguyên)', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const { prisma } = await save(last());
      expect(prisma.wikiPageVersion.update).toHaveBeenCalledWith({
        where: { wikiPageId_version: { wikiPageId: 'g1', version: 3 } },
        data: { title: 'T', body: 'mới', createdAt: NOW },
      });
      expect(prisma.wikiPageVersion.create).not.toHaveBeenCalled();
      expect(prisma.wikiPageVersion.deleteMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('quá 10 phút → tạo phiên bản mới', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const { prisma } = await save(last({ createdAt: new Date(NOW.getTime() - 11 * 60_000) }));
      expect(prisma.wikiPageVersion.update).not.toHaveBeenCalled();
      expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 4, body: 'mới' }) as unknown,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('người khác lưu → tạo phiên bản mới dù rất gần', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const { prisma } = await save(last(), 'u7');
      expect(prisma.wikiPageVersion.update).not.toHaveBeenCalled();
      expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 4, authorId: 'u7' }) as unknown,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bản trước là bản khôi phục (có note) → không ghi đè, tạo mới', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const { prisma } = await save(last({ note: 'Khôi phục từ phiên bản 1' }));
      expect(prisma.wikiPageVersion.update).not.toHaveBeenCalled();
      expect(prisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 4 }) as unknown,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('khôi phục (có note) không bao giờ gộp, kể cả cùng người trong cửa sổ', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const ctx = setup(false);
      ctx.prisma.wikiPageVersion.findFirst
        .mockResolvedValueOnce({ version: 1, title: 'Cũ', body: 'bản 1' })
        .mockResolvedValueOnce(last());
      ctx.prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
      await ctx.service.restoreVersion('w1', 'g1', 1, { expectedVersion: 0 }, { id: 'u2' });
      expect(ctx.prisma.wikiPageVersion.update).not.toHaveBeenCalled();
      expect(ctx.prisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 4, note: 'Khôi phục từ phiên bản 1' }) as unknown,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('tick ô checklist (cùng người, ngay sau lần lưu) không sinh phiên bản riêng', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const ctx = setup(false);
      ctx.prisma.wikiPageVersion.findFirst.mockResolvedValueOnce(
        last({ body: '- [ ] a\n- [ ] b' }),
      );
      await ctx.service.update(
        'w1',
        'g1',
        { body: '- [x] a\n- [ ] b', expectedVersion: 0 },
        {
          id: 'u2',
        },
      );
      expect(ctx.prisma.wikiPageVersion.create).not.toHaveBeenCalled();
      expect(ctx.prisma.wikiPageVersion.update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mốc 200 chỉ tính khi tạo mới (gộp không xoá bản nào)', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const { prisma } = await save(last({ version: 205 }));
      expect(prisma.wikiPageVersion.deleteMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WikiService — nhật ký kiểm toán & điểm lọc quyền đọc (A18/A20)', () => {
  it('restoreVersion(): ghi nhật ký wiki.version_restored sau khi ghi', async () => {
    const { service, prisma, audit } = setup(false);
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce({ version: 2, title: 'Cũ', body: 'x' });
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.restoreVersion('w1', 'g1', 2, { expectedVersion: 0 }, { id: 'u3' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        actorId: 'u3',
        action: 'wiki.version_restored',
        entityId: 'g1',
        meta: expect.objectContaining({ version: 2 }) as unknown,
      }),
    );
  });

  it('restoreVersion(): xung đột 409 → không ghi nhật ký', async () => {
    const { service, prisma, audit } = setup(false);
    prisma.wikiPageVersion.findFirst.mockResolvedValueOnce({ version: 2, title: 'Cũ', body: 'x' });
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.restoreVersion('w1', 'g1', 2, { expectedVersion: 0 }, U),
    ).rejects.toMatchObject({ status: 409 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('undelete(): ghi nhật ký wiki.page_restored', async () => {
    const { service, prisma, audit } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValueOnce({
      id: 'g1',
      title: 'Cũ',
      projectId: 'p1',
      parentId: null,
    } as never);
    await service.undelete('w1', 'g1', { id: 'u4' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u4', action: 'wiki.page_restored', entityId: 'g1' }),
    );
  });

  it('undelete(): người khác vừa khôi phục (updateMany count 0) → 404, không ghi nhật ký', async () => {
    const { service, prisma, audit } = setup(false);
    prisma.wikiPage.findFirst.mockResolvedValueOnce({
      id: 'g1',
      title: 'Cũ',
      projectId: 'p1',
      parentId: null,
    } as never);
    prisma.wikiPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.undelete('w1', 'g1', U)).rejects.toMatchObject({ status: 404 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('listVersions/getVersion/trash đi qua readableWhere (điểm cắm P15) với đúng viewer', async () => {
    const { service, prisma } = setup(false);
    const spy = vi
      .spyOn(service as unknown as { readableWhere: () => Promise<object> }, 'readableWhere')
      .mockResolvedValue({ projectId: 'chỉ-dự-án-xem-được' });
    await service.listVersions('w1', 'g1', U);
    await service.getVersion('w1', 'g1', 1, U).catch(() => undefined);
    await service.trash('w1', 'p1', U);
    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) expect(call).toEqual([U, 'w1']);
    const wheres = [
      prisma.wikiPage.findFirst.mock.calls[0]![0],
      prisma.wikiPage.findFirst.mock.calls[1]![0],
      prisma.wikiPage.findMany.mock.calls[0]![0],
    ];
    for (const w of wheres) expect(JSON.stringify(w)).toContain('chỉ-dự-án-xem-được');
  });
});
