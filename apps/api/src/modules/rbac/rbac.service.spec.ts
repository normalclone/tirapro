import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { describe, expect, it, vi } from 'vitest';
import { RbacService } from './rbac.service';

function makeStream(batches: string[][]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const b of batches) yield b;
    },
  };
}

function setup(redis: 'ok' | 'down' = 'ok') {
  const client = {
    scanStream: vi.fn((_opts: unknown) => makeStream([['rbac:W1:U1:-', 'rbac:W1:U1:P1'], [], ['rbac:W1:U1:P2']])),
    unlink: vi.fn(async (..._keys: string[]) => 1),
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
    comment: { findFirst: vi.fn() },
    attachment: { findFirst: vi.fn() },
    issueLink: { findFirst: vi.fn() },
    version: { findFirst: vi.fn() },
    workspaceMembership: { findUnique: vi.fn(async () => null) },
    projectMembership: { findUnique: vi.fn(async () => null) },
    rolePermission: { findMany: vi.fn(async () => []) },
    role: { findMany: vi.fn(async () => []) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new RbacService(prisma as any, redisSvc as any);
  return { svc, client, prisma };
}

describe('RbacService cache invalidation', () => {
  it('invalidateWorkspace dùng SCAN + UNLINK, không dùng KEYS', async () => {
    const { svc, client } = setup();
    await svc.invalidateWorkspace('W1');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scanStream).toHaveBeenCalledWith({ match: 'rbac:W1:*', count: 200 });
    expect(client.unlink).toHaveBeenCalledTimes(2); // batch rỗng bị bỏ qua
    expect(client.unlink).toHaveBeenCalledWith('rbac:W1:U1:-', 'rbac:W1:U1:P1');
    expect(client.unlink).toHaveBeenCalledWith('rbac:W1:U1:P2');
  });

  it('invalidate (1 user) dùng SCAN theo user', async () => {
    const { svc, client } = setup();
    await svc.invalidate('U1', 'W1');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scanStream).toHaveBeenCalledWith({ match: 'rbac:W1:U1:*', count: 200 });
    expect(client.unlink).toHaveBeenCalled();
  });

  it('Redis không sẵn sàng -> bỏ qua, không ném lỗi', async () => {
    const { svc, client } = setup('down');
    await expect(svc.invalidateWorkspace('W1')).resolves.toBeUndefined();
    expect(client.scanStream).not.toHaveBeenCalled();
  });

  it('lỗi khi SCAN bị nuốt (degrade)', async () => {
    const { svc, client } = setup();
    client.scanStream.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(svc.invalidateWorkspace('W1')).resolves.toBeUndefined();
  });
});

describe('RbacService.resolveProjectId', () => {
  it('issue: findFirst theo workspaceId, trả projectId', async () => {
    const { svc, prisma } = setup();
    prisma.issue.findFirst.mockResolvedValue({ projectId: 'P1' });
    await expect(svc.resolveProjectId('W1', 'issue', 'I1')).resolves.toBe('P1');
    expect(prisma.issue.findFirst).toHaveBeenCalledWith({
      where: { id: 'I1', workspaceId: 'W1' },
      select: { projectId: true },
    });
  });

  it.each(['sprint', 'board', 'label', 'component'] as const)('%s: lọc qua project.workspaceId', async (kind) => {
    const { svc, prisma } = setup();
    prisma[kind].findFirst.mockResolvedValue({ projectId: 'P9' });
    await expect(svc.resolveProjectId('W1', kind, 'X1')).resolves.toBe('P9');
    expect(prisma[kind].findFirst).toHaveBeenCalledWith({
      where: { id: 'X1', project: { workspaceId: 'W1' } },
      select: { projectId: true },
    });
  });

  it('comment: đi qua issue.workspaceId, comment ngoài workspace -> null (guard sẽ NotFound)', async () => {
    const { svc, prisma } = setup();
    prisma.comment.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'comment', 'C-ws-khac')).resolves.toBeNull();
    expect(prisma.comment.findFirst).toHaveBeenCalledWith({
      where: { id: 'C-ws-khac', issue: { workspaceId: 'W1' } },
      select: { issue: { select: { projectId: true } } },
    });
  });

  it('comment trong workspace -> projectId của issue cha', async () => {
    const { svc, prisma } = setup();
    prisma.comment.findFirst.mockResolvedValue({ issue: { projectId: 'P7' } });
    await expect(svc.resolveProjectId('W1', 'comment', 'C1')).resolves.toBe('P7');
  });

  it('attachment: gắn trực tiếp vào issue hoặc qua comment', async () => {
    const { svc, prisma } = setup();
    prisma.attachment.findFirst.mockResolvedValueOnce({ issue: { projectId: 'P1' }, comment: null });
    await expect(svc.resolveProjectId('W1', 'attachment', 'A1')).resolves.toBe('P1');
    prisma.attachment.findFirst.mockResolvedValueOnce({ issue: null, comment: { issue: { projectId: 'P2' } } });
    await expect(svc.resolveProjectId('W1', 'attachment', 'A2')).resolves.toBe('P2');
    prisma.attachment.findFirst.mockResolvedValueOnce(null);
    await expect(svc.resolveProjectId('W1', 'attachment', 'A3')).resolves.toBeNull();
  });

  it('issueLink: một trong hai đầu thuộc workspace; lấy projectId của đầu nguồn nếu có', async () => {
    const { svc, prisma } = setup();
    prisma.issueLink.findFirst.mockResolvedValue({ source: { projectId: 'P1', workspaceId: 'W1' }, target: { projectId: 'P2', workspaceId: 'W1' } });
    await expect(svc.resolveProjectId('W1', 'issueLink', 'L1')).resolves.toBe('P1');
    expect(prisma.issueLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'L1', OR: [{ source: { workspaceId: 'W1' } }, { target: { workspaceId: 'W1' } }] } }),
    );
  });

  it('issueLink: đầu nguồn ở workspace khác thì dùng đầu đích trong workspace', async () => {
    const { svc, prisma } = setup();
    prisma.issueLink.findFirst.mockResolvedValue({ source: { projectId: 'PX', workspaceId: 'W2' }, target: { projectId: 'P2', workspaceId: 'W1' } });
    await expect(svc.resolveProjectId('W1', 'issueLink', 'L1')).resolves.toBe('P2');
  });

  it('version: lọc qua project.workspaceId', async () => {
    const { svc, prisma } = setup();
    prisma.version.findFirst.mockResolvedValue({ projectId: 'P3' });
    await expect(svc.resolveProjectId('W1', 'version', 'V1')).resolves.toBe('P3');
    expect(prisma.version.findFirst).toHaveBeenCalledWith({
      where: { id: 'V1', project: { workspaceId: 'W1' } },
      select: { projectId: true },
    });
  });

  it('không tìm thấy -> null', async () => {
    const { svc, prisma } = setup();
    prisma.issue.findFirst.mockResolvedValue(null);
    await expect(svc.resolveProjectId('W1', 'issue', 'I-x')).resolves.toBeNull();
  });
});

describe('RbacService.assertProjectInWorkspace', () => {
  it('NotFound khi dự án không thuộc workspace', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(svc.assertProjectInWorkspace('P1', 'W1')).rejects.toBeInstanceOf(NotFoundAppException);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'P1', workspaceId: 'W1' },
      select: { id: true },
    });
  });

  it('qua khi thuộc workspace', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue({ id: 'P1' });
    await expect(svc.assertProjectInWorkspace('P1', 'W1')).resolves.toBeUndefined();
  });
});

describe('RbacService.getEffectivePermissions', () => {
  it('membership dự án chỉ tính khi dự án thuộc workspace', async () => {
    const { svc, prisma } = setup('down');
    await svc.getEffectivePermissions('U1', 'W1', 'P1');
    expect(prisma.projectMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: 'P1', userId: 'U1' }, project: { workspaceId: 'W1' } },
      }),
    );
  });
});
