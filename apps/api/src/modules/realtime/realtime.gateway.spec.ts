import { describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '@tirapro/types';
import { RealtimeGateway } from './realtime.gateway';

function makeGateway(
  projectRow: unknown = null,
  issueRow: unknown = null,
  canSee: boolean | ((userId: string, ws: string, projectId: string) => boolean) = true,
) {
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue(projectRow) },
    issue: {
      findFirst: vi.fn().mockResolvedValue(issueRow),
      // room issue:<id> nào thuộc dự án bị rút (mặc định: các id có tên bắt đầu 'IP-' thuộc dự án đó)
      findMany: vi.fn((a: { where: { projectId?: string; id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.filter((id) => id.startsWith('IP-')).map((id) => ({ id }))),
      ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        displayName: 'An',
        avatarUrl: null,
        status: 'ACTIVE',
        isSystemAdmin: false,
      }),
    },
    workspaceMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'M1' }) },
  };
  const presence = {
    join: vi
      .fn()
      .mockResolvedValue({ userId: 'U1', displayName: 'An', avatarUrl: null, viewing: null }),
    leave: vi.fn().mockResolvedValue(undefined),
    state: vi
      .fn()
      .mockResolvedValue([{ userId: 'U1', displayName: 'An', avatarUrl: null, viewing: null }]),
    setViewing: vi.fn(),
  };
  const jwt = { verify: vi.fn() };
  const config = { get: vi.fn() };
  const access = {
    canSee: vi.fn((u: string, w: string, p: string) =>
      Promise.resolve(typeof canSee === 'function' ? canSee(u, w, p) : canSee),
    ),
  };
  const gateway = new RealtimeGateway(
    jwt as never,
    config as never,
    prisma as never,
    presence as never,
    access as never,
  );
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const fetchSockets = vi.fn().mockResolvedValue([]);
  const disconnectSockets = vi.fn();
  const inRoom = vi.fn().mockReturnValue({ fetchSockets, disconnectSockets });
  (gateway as unknown as { server: unknown }).server = { to, in: inRoom };
  return {
    gateway,
    prisma,
    presence,
    jwt,
    config,
    to,
    emit,
    fetchSockets,
    disconnectSockets,
    access,
  };
}

function makeClient(data: Record<string, unknown> = { userId: 'U1', workspaceId: 'W1' }) {
  const toEmit = vi.fn();
  return {
    id: 'sock-1',
    data,
    rooms: new Set<string>(),
    join: vi.fn(),
    leave: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: toEmit }),
    toEmit,
  };
}

describe('RealtimeGateway.onSubscribe — kiểm quyền', () => {
  it('từ chối project thuộc workspace khác và không join', async () => {
    const { gateway, prisma } = makeGateway(null);
    const client = makeClient();
    const res = await gateway.onSubscribe({ kind: 'project', id: 'P2' }, client as never);
    expect(res).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(client.join).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'P2', workspaceId: 'W1', deletedAt: null },
      select: { id: true },
    });
  });

  it('cho join project thuộc workspace của mình', async () => {
    const { gateway } = makeGateway({ id: 'P1' });
    const client = makeClient();
    const res = await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(res).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('project:P1');
  });

  it('không tra DB và từ chối khi client chưa có workspace', async () => {
    const { gateway, prisma } = makeGateway({ id: 'P1' });
    const client = makeClient({ userId: 'U1', workspaceId: null });
    const res = await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(res).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('chỉ cho join room user của chính mình', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'user', id: 'U2' } as never, client as never)).toEqual(
      {
        ok: false,
        error: 'FORBIDDEN',
      },
    );
    expect(client.join).not.toHaveBeenCalled();
    expect(await gateway.onSubscribe({ kind: 'user', id: 'U1' } as never, client as never)).toEqual(
      { ok: true },
    );
    expect(client.join).toHaveBeenCalledWith('user:U1');
  });

  it('chỉ cho join room workspace của mình (đúng tên room ws:<id>)', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    expect(
      await gateway.onSubscribe({ kind: 'workspace', id: 'W2' } as never, client as never),
    ).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
    expect(
      await gateway.onSubscribe({ kind: 'workspace', id: 'W1' } as never, client as never),
    ).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('ws:W1');
  });

  it('từ chối loại room lạ và payload thiếu', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'bogus', id: 'X' } as never, client as never)).toEqual(
      {
        ok: false,
        error: 'FORBIDDEN',
      },
    );
    expect(await gateway.onSubscribe(undefined as never, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('nuốt lỗi DB và trả FORBIDDEN thay vì ném', async () => {
    const { gateway, prisma } = makeGateway();
    prisma.project.findFirst.mockRejectedValue(new Error('db down'));
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
  });
});

/** Bị từ chối thì không vào room dữ liệu nào (chỉ room user của chính mình được vào sớm để bắt sự kiện thu hồi). */
function expectNoDataRooms(client: { join: ReturnType<typeof vi.fn> }) {
  const joined = client.join.mock.calls.map((c) => c[0] as string);
  expect(joined.filter((r) => r !== 'user:U1')).toEqual([]);
}

describe('RealtimeGateway.handleConnection — membership', () => {
  function connect(userRow: unknown, membership: unknown) {
    const ctx = makeGateway();
    ctx.jwt.verify.mockReturnValue({ sub: 'U1', workspaceId: 'W1' });
    ctx.prisma.user.findUnique.mockResolvedValue(userRow);
    ctx.prisma.workspaceMembership.findUnique.mockResolvedValue(membership);
    const client = { ...makeClient({}), handshake: { auth: { token: 't' }, headers: {} } };
    return { ...ctx, client };
  }

  it('cho vào khi user ACTIVE và còn là thành viên workspace', async () => {
    const { gateway, client, prisma } = connect(
      { status: 'ACTIVE', isSystemAdmin: false },
      { id: 'M1' },
    );
    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:U1');
    expect(client.join).toHaveBeenCalledWith('ws:W1');
    expect(prisma.workspaceMembership.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'W1', userId: 'U1' } },
      select: { id: true },
    });
  });

  it('từ chối (disconnect, không join room nào) khi token còn hạn nhưng không còn membership', async () => {
    const { gateway, client } = connect({ status: 'ACTIVE', isSystemAdmin: false }, null);
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expectNoDataRooms(client);
  });

  it('từ chối user DEACTIVATED dù còn membership', async () => {
    const { gateway, client } = connect(
      { status: 'DEACTIVATED', isSystemAdmin: false },
      { id: 'M1' },
    );
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expectNoDataRooms(client);
  });

  it('system admin được miễn kiểm membership', async () => {
    const { gateway, client, prisma } = connect({ status: 'ACTIVE', isSystemAdmin: true }, null);
    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(prisma.workspaceMembership.findUnique).not.toHaveBeenCalled();
  });

  it('lỗi DB khi kiểm -> từ chối (fail closed)', async () => {
    const { gateway, client, prisma } = connect({ status: 'ACTIVE', isSystemAdmin: false }, null);
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('JWT sai -> disconnect', async () => {
    const { gateway, client, jwt } = connect(
      { status: 'ACTIVE', isSystemAdmin: false },
      { id: 'M1' },
    );
    jwt.verify.mockImplementation(() => {
      throw new Error('bad');
    });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('RealtimeGateway.onSubscribe — membership bị gỡ sau handshake', () => {
  it('từ chối mọi room (kể cả workspace/project) và không join', async () => {
    const { gateway, prisma } = makeGateway({ id: 'P1' });
    prisma.workspaceMembership.findUnique.mockResolvedValue(null);
    const client = makeClient();
    for (const target of [
      { kind: 'project', id: 'P1' },
      { kind: 'workspace', id: 'W1' },
      { kind: 'user', id: 'U1' },
    ] as const) {
      expect(await gateway.onSubscribe(target, client as never)).toEqual({
        ok: false,
        error: 'FORBIDDEN',
      });
    }
    expect(client.join).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('từ chối khi user bị DEACTIVATED sau handshake', async () => {
    const { gateway, prisma } = makeGateway({ id: 'P1' });
    prisma.user.findUnique.mockResolvedValue({
      status: 'DEACTIVATED',
      isSystemAdmin: false,
      displayName: 'An',
      avatarUrl: null,
    });
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
  });
});

describe('RealtimeGateway — phiên bị thu hồi (sessionsRevokedAt)', () => {
  const revokedAt = new Date(2_000_500);
  function connect(token: Record<string, unknown>) {
    const ctx = makeGateway();
    ctx.jwt.verify.mockReturnValue({ sub: 'U1', workspaceId: 'W1', ...token });
    ctx.prisma.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isSystemAdmin: false,
      sessionsRevokedAt: revokedAt,
    });
    const client = { ...makeClient({}), handshake: { auth: { token: 't' }, headers: {} } };
    return { ...ctx, client };
  }

  it('kết nối mới bằng token cấp TRƯỚC mốc thu hồi -> disconnect, không join room', async () => {
    const { gateway, client } = connect({ iat: 2000, iatMs: 2_000_400 });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expectNoDataRooms(client);
  });

  it('token cũ chỉ có iat (trước mốc theo giây) cũng bị từ chối', async () => {
    const { gateway, client } = connect({ iat: 1000 });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('token cấp SAU mốc thu hồi (đăng nhập lại) -> cho vào', async () => {
    const { gateway, client } = connect({ iat: 2000, iatMs: 2_000_600 });
    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith('user:U1');
  });

  it('subscribe sau khi phiên bị thu hồi -> FORBIDDEN, không join', async () => {
    const { gateway, prisma } = makeGateway({ id: 'P1' });
    prisma.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isSystemAdmin: false,
      sessionsRevokedAt: revokedAt,
    });
    const client = makeClient({ userId: 'U1', workspaceId: 'W1', iat: 2000, iatMs: 2_000_400 });
    expect(await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('onSessionsRevoked ngắt mọi socket trong room user:<id> (qua adapter, kể cả node khác)', async () => {
    const { gateway, disconnectSockets } = makeGateway();
    await gateway.onSessionsRevoked({ userId: 'U1' });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('user:U1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('onSessionsRevoked bỏ qua payload thiếu userId', async () => {
    const { gateway, disconnectSockets } = makeGateway();
    await gateway.onSessionsRevoked({});
    expect(disconnectSockets).not.toHaveBeenCalled();
  });

  it('có revokedAtMs (tự đổi mật khẩu): chỉ ngắt socket mang token cấp TRƯỚC mốc, giữ socket token mới', async () => {
    const { gateway, fetchSockets, disconnectSockets } = makeGateway();
    const oldTab = { data: { iat: 2000, iatMs: 2_000_100 }, disconnect: vi.fn() };
    const oldNoMs = { data: { iat: 1000 }, disconnect: vi.fn() };
    const newTab = { data: { iat: 2000, iatMs: 2_000_900 }, disconnect: vi.fn() };
    fetchSockets.mockResolvedValue([oldTab, oldNoMs, newTab]);
    await gateway.onSessionsRevoked({ userId: 'U1', revokedAtMs: 2_000_500 });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('user:U1');
    expect(oldTab.disconnect).toHaveBeenCalledWith(true);
    expect(oldNoMs.disconnect).toHaveBeenCalledWith(true);
    expect(newTab.disconnect).not.toHaveBeenCalled();
    expect(disconnectSockets).not.toHaveBeenCalled();
  });

  it('handleConnection vào room user TRƯỚC khi kiểm quyền (sự kiện thu hồi tới giữa chừng không lọt)', async () => {
    const ctx = makeGateway();
    ctx.jwt.verify.mockReturnValue({ sub: 'U1', workspaceId: 'W1' });
    const order: string[] = [];
    const client = { ...makeClient({}), handshake: { auth: { token: 't' }, headers: {} } };
    client.join = vi.fn((room: string) => {
      order.push(`join:${room}`);
    });
    ctx.prisma.user.findUnique.mockImplementation(() => {
      order.push('hasAccess');
      return Promise.resolve({ status: 'ACTIVE', isSystemAdmin: false, sessionsRevokedAt: null });
    });
    await ctx.gateway.handleConnection(client as never);
    expect(order.slice(0, 2)).toEqual(['join:user:U1', 'hasAccess']);
    expect(order).toContain('join:ws:W1');
  });
});

describe('RealtimeGateway.onMemberRemoved', () => {
  it('ngắt socket của đúng user trong room ws:<id>, giữ nguyên socket người khác', async () => {
    const { gateway, fetchSockets } = makeGateway();
    const mine = { data: { userId: 'U1' }, disconnect: vi.fn() };
    const mine2 = { data: { userId: 'U1' }, disconnect: vi.fn() };
    const other = { data: { userId: 'U2' }, disconnect: vi.fn() };
    fetchSockets.mockResolvedValue([mine, other, mine2]);
    await gateway.onMemberRemoved({ workspaceId: 'W1', userId: 'U1' });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('ws:W1');
    expect(mine.disconnect).toHaveBeenCalledWith(true);
    expect(mine2.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
  });

  it('bỏ qua payload thiếu và nuốt lỗi fetchSockets', async () => {
    const { gateway, fetchSockets } = makeGateway();
    await gateway.onMemberRemoved({ workspaceId: 'W1' });
    expect(fetchSockets).not.toHaveBeenCalled();
    fetchSockets.mockRejectedValue(new Error('redis'));
    await expect(
      gateway.onMemberRemoved({ workspaceId: 'W1', userId: 'U1' }),
    ).resolves.toBeUndefined();
  });
});

describe('RealtimeGateway — bridge notification & sprint', () => {
  it('comment.updated -> comment:updated tới room project', () => {
    const { gateway, to, emit } = makeGateway();
    const comment = { id: 'C1', issueId: 'I1' } as never;
    gateway.onCommentUpdated({ comment, issueId: 'I1', projectId: 'P1' });
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.COMMENT_UPDATED, { comment });
  });

  it('comment.updated thiếu projectId thì bỏ qua', () => {
    const { gateway, to, emit } = makeGateway();
    const comment = { id: 'C1', issueId: 'I1' } as never;
    gateway.onCommentUpdated({ comment, issueId: 'I1' });
    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('comment.deleted -> comment:deleted {commentId, issueId} tới room project; thiếu projectId thì bỏ qua', () => {
    const { gateway, to, emit } = makeGateway();
    gateway.onCommentDeleted({ commentId: 'C1', issueId: 'I1', projectId: 'P1' });
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.COMMENT_DELETED, {
      commentId: 'C1',
      issueId: 'I1',
    });
    to.mockClear();
    gateway.onCommentDeleted({ commentId: 'C1', issueId: 'I1' });
    expect(to).not.toHaveBeenCalled();
  });

  it('comment.reacted -> comment:reaction CHỈ {commentId, issueId} tới room project (không tên người thả, không actorId); thiếu projectId thì bỏ qua', () => {
    const { gateway, to, emit } = makeGateway();
    gateway.onCommentReacted({
      commentId: 'C1',
      issueId: 'I1',
      projectId: 'P1',
      actorId: 'U1',
    });
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.COMMENT_REACTION, {
      commentId: 'C1',
      issueId: 'I1',
    });
    expect(WS_EVENTS.COMMENT_REACTION).toBe('comment:reaction');
    to.mockClear();
    gateway.onCommentReacted({ commentId: 'C1', issueId: 'I1', actorId: 'U1' });
    expect(to).not.toHaveBeenCalled();
  });

  it('project.ranks_rebalanced -> project:ranks_rebalanced tới room project', () => {
    const { gateway, to, emit } = makeGateway();
    gateway.onProjectRanksRebalanced({ projectId: 'P1' });
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.PROJECT_RANKS_REBALANCED, { projectId: 'P1' });
  });

  it('project.ranks_rebalanced thiếu projectId thì bỏ qua', () => {
    const { gateway, to } = makeGateway();
    gateway.onProjectRanksRebalanced({});
    expect(to).not.toHaveBeenCalled();
  });

  it('notification.created -> notification:new tới room user của người nhận', () => {
    const { gateway, to, emit } = makeGateway();
    const notification = { id: 'N1', type: 'MENTIONED' } as never;
    gateway.onNotificationCreated({ recipientId: 'U9', notification });
    expect(to).toHaveBeenCalledWith('user:U9');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.NOTIFICATION_NEW, { notification });
  });

  it('bỏ qua notification.created thiếu recipientId', () => {
    const { gateway, to } = makeGateway();
    gateway.onNotificationCreated({ notification: { id: 'N1' } as never });
    expect(to).not.toHaveBeenCalled();
  });

  it.each(['onSprintStarted', 'onSprintCompleted', 'onSprintUpdated'] as const)(
    '%s -> sprint:updated tới room project',
    (method) => {
      const { gateway, to, emit } = makeGateway();
      gateway[method]({ sprintId: 'S1', projectId: 'P1' });
      expect(to).toHaveBeenCalledWith('project:P1');
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.SPRINT_UPDATED, {
        sprintId: 'S1',
        projectId: 'P1',
      });
    },
  );
});

describe('RealtimeGateway — issue room', () => {
  it('cho join room issue thuộc workspace, từ chối issue ngoài workspace', async () => {
    const ok = makeGateway(null, { id: 'I1', projectId: 'P1' });
    const client = makeClient();
    expect(await ok.gateway.onSubscribe({ kind: 'issue', id: 'I1' }, client as never)).toEqual({
      ok: true,
    });
    expect(client.join).toHaveBeenCalledWith('issue:I1');
    expect(ok.prisma.issue.findFirst).toHaveBeenCalledWith({
      where: { id: 'I1', workspaceId: 'W1', deletedAt: null },
      select: { id: true, projectId: true },
    });

    const denied = makeGateway(null, null);
    const c2 = makeClient();
    expect(await denied.gateway.onSubscribe({ kind: 'issue', id: 'I9' }, c2 as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(c2.join).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway — presence', () => {
  it('subscribe project thành công -> join presence, báo người khác, gửi state cho client mới', async () => {
    const { gateway, presence } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(presence.join).toHaveBeenCalledWith('project:P1', {
      userId: 'U1',
      displayName: 'An',
      avatarUrl: null,
    });
    expect(client.to).toHaveBeenCalledWith('project:P1');
    expect(client.toEmit).toHaveBeenCalledWith(WS_EVENTS.PRESENCE_JOIN, {
      room: 'project:P1',
      user: expect.objectContaining({ userId: 'U1' }) as unknown,
    });
    expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.PRESENCE_STATE, {
      room: 'project:P1',
      users: [expect.objectContaining({ userId: 'U1' })],
    });
    expect(client.data.rooms).toEqual(['project:P1']);
  });

  it('subscribe bị từ chối -> KHÔNG join presence', async () => {
    const { gateway, presence } = makeGateway(null);
    await gateway.onSubscribe({ kind: 'project', id: 'P2' }, makeClient() as never);
    expect(presence.join).not.toHaveBeenCalled();
  });

  it('subscribe user/workspace/issue không kích hoạt presence', async () => {
    const { gateway, presence } = makeGateway({ id: 'P1' }, { id: 'I1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'workspace', id: 'W1' }, client as never);
    await gateway.onSubscribe({ kind: 'issue', id: 'I1' }, client as never);
    expect(presence.join).not.toHaveBeenCalled();
  });

  it('subscribe project lần hai không phát presence:join lặp', async () => {
    const { gateway } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(client.toEmit).toHaveBeenCalledTimes(1);
    expect(client.data.rooms).toEqual(['project:P1']);
  });

  it('unsubscribe project -> leave + presence:leave', async () => {
    const { gateway, presence, to, emit } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    await gateway.onUnsubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(presence.leave).toHaveBeenCalledWith('project:P1', 'U1');
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.PRESENCE_LEAVE, {
      room: 'project:P1',
      userId: 'U1',
    });
    expect(client.data.rooms).toEqual([]);
  });

  it('disconnect rời mọi room đã vào', async () => {
    const { gateway, presence, emit } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    await gateway.onSubscribe({ kind: 'project', id: 'P2' }, client as never);
    gateway.handleDisconnect(client as never);
    await vi.waitFor(() => expect(presence.leave).toHaveBeenCalledTimes(2));
    expect(presence.leave).toHaveBeenCalledWith('project:P1', 'U1');
    expect(presence.leave).toHaveBeenCalledWith('project:P2', 'U1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.PRESENCE_LEAVE, {
      room: 'project:P2',
      userId: 'U1',
    });
  });

  it('disconnect giữ presence nếu cùng user còn tab khác trong room', async () => {
    const { gateway, presence, fetchSockets } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    fetchSockets.mockResolvedValue([{ id: 'sock-2', data: { userId: 'U1' } }]);
    gateway.handleDisconnect(client as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(presence.leave).not.toHaveBeenCalled();
  });

  it('disconnect của client chưa vào room nào thì không làm gì', () => {
    const { gateway, presence } = makeGateway();
    gateway.handleDisconnect(makeClient() as never);
    expect(presence.leave).not.toHaveBeenCalled();
  });

  it('presence:view đổi viewing -> phát presence:state cho room project', async () => {
    const { gateway, presence, to, emit } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    to.mockClear();
    emit.mockClear();
    presence.setViewing.mockResolvedValue({ changed: true, user: { userId: 'U1' } });
    await gateway.onPresenceView({ room: 'issue:I1' }, client as never);
    expect(presence.setViewing).toHaveBeenCalledWith('project:P1', 'U1', 'issue:I1');
    expect(to).toHaveBeenCalledWith('project:P1');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.PRESENCE_STATE, {
      room: 'project:P1',
      users: expect.any(Array) as unknown,
    });
  });

  it('presence:view heartbeat (không đổi) không phát lại state; room lạ coi như null', async () => {
    const { gateway, presence, emit } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    emit.mockClear();
    presence.setViewing.mockResolvedValue({ changed: false, user: { userId: 'U1' } });
    await gateway.onPresenceView({ room: 'bogus:1' }, client as never);
    expect(presence.setViewing).toHaveBeenCalledWith('project:P1', 'U1', null);
    expect(emit).not.toHaveBeenCalled();
  });

  it('presence:view khi entry đã hết hạn -> join lại rồi đặt viewing', async () => {
    const { gateway, presence } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    presence.join.mockClear();
    presence.setViewing
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ changed: true, user: { userId: 'U1' } });
    await gateway.onPresenceView({ room: null }, client as never);
    expect(presence.join).toHaveBeenCalledTimes(1);
    expect(presence.setViewing).toHaveBeenCalledTimes(2);
  });
});

describe('RealtimeGateway — presence:view tới trước subscribe', () => {
  it('viewing nhận trước khi join presence được áp dụng ngay sau khi join', async () => {
    const { gateway, presence } = makeGateway({ id: 'P1' });
    const client = makeClient();
    await gateway.onPresenceView({ room: 'issue:I1' }, client as never); // chưa vào room nào
    expect(presence.setViewing).not.toHaveBeenCalled();
    presence.setViewing.mockResolvedValue({
      changed: true,
      user: { userId: 'U1', viewing: 'issue:I1' },
    });
    await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(presence.setViewing).toHaveBeenCalledWith('project:P1', 'U1', 'issue:I1');
  });
});

describe('RealtimeGateway — typing', () => {
  it('relay typing tới room issue trừ người gửi (client.to)', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    client.rooms.add('issue:I1');
    await gateway.onTypingStart({ room: 'issue:I1' }, client as never);
    expect(client.to).toHaveBeenCalledWith('issue:I1');
    expect(client.toEmit).toHaveBeenCalledWith(WS_EVENTS.TYPING, {
      room: 'issue:I1',
      userId: 'U1',
      displayName: 'An',
      typing: true,
    });
    await gateway.onTypingStop({ room: 'issue:I1' }, client as never);
    expect(client.toEmit).toHaveBeenLastCalledWith(
      WS_EVENTS.TYPING,
      expect.objectContaining({ typing: false }),
    );
  });

  it('bỏ qua typing vào room chưa subscribe / sai dạng', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    await gateway.onTypingStart({ room: 'issue:I1' }, client as never); // chưa join
    client.rooms.add('project:P1');
    await gateway.onTypingStart({ room: 'project:P1' }, client as never); // không phải issue
    await gateway.onTypingStart(undefined as never, client as never);
    expect(client.to).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway — dự án riêng tư (P16)', () => {
  it('subscribe project riêng tư khi không thấy dự án -> FORBIDDEN, không join, không vào presence', async () => {
    const { gateway, access, presence } = makeGateway({ id: 'P1' }, null, false);
    const client = makeClient();
    const res = await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never);
    expect(res).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(access.canSee).toHaveBeenCalledWith('U1', 'W1', 'P1');
    expect(client.join).not.toHaveBeenCalled();
    expect(presence.join).not.toHaveBeenCalled();
  });

  it('thành viên dự án (canSee) vào được room project', async () => {
    const { gateway } = makeGateway({ id: 'P1' }, null, true);
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'project', id: 'P1' }, client as never)).toEqual({
      ok: true,
    });
    expect(client.join).toHaveBeenCalledWith('project:P1');
  });

  it('room issue của dự án ẩn -> FORBIDDEN (kiểm theo dự án của công việc)', async () => {
    const { gateway, access } = makeGateway(null, { id: 'I1', projectId: 'P1' }, false);
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'issue', id: 'I1' }, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(access.canSee).toHaveBeenCalledWith('U1', 'W1', 'P1');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('onProjectMemberRemoved: rút socket của đúng user (mọi tab) khỏi room project VÀ room issue của dự án khi không còn thấy dự án', async () => {
    const { gateway, fetchSockets, presence, prisma } = makeGateway(null, null, false);
    const tab1 = {
      data: { userId: 'U1' },
      rooms: new Set(['user:U1', 'project:P1', 'issue:IP-1', 'issue:OTHER-9']),
      leave: vi.fn(),
    };
    // tab chỉ mở một việc, KHÔNG vào room project — vẫn phải bị rút khỏi room issue của dự án
    const tab2 = {
      data: { userId: 'U1' },
      rooms: new Set(['user:U1', 'issue:IP-2']),
      leave: vi.fn(),
    };
    const other = { data: { userId: 'U2' }, rooms: new Set(['project:P1']), leave: vi.fn() };
    fetchSockets.mockResolvedValue([tab1, tab2, other]);
    await gateway.onProjectMemberRemoved({ workspaceId: 'W1', projectId: 'P1', userId: 'U1' });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('user:U1');
    expect(tab1.leave).toHaveBeenCalledWith('project:P1');
    expect(tab1.leave).toHaveBeenCalledWith('issue:IP-1');
    expect(tab1.leave).not.toHaveBeenCalledWith('issue:OTHER-9'); // việc của dự án khác giữ nguyên
    expect(tab2.leave).toHaveBeenCalledWith('issue:IP-2');
    expect(other.leave).not.toHaveBeenCalled();
    const q = prisma.issue.findMany.mock.calls[0]![0].where;
    expect(q.projectId).toBe('P1');
    expect([...q.id.in].sort()).toEqual(['IP-1', 'IP-2', 'OTHER-9']);
    expect(presence.leave).toHaveBeenCalledWith('project:P1', 'U1');
    expect(presence.leave).toHaveBeenCalledWith('issue:IP-1', 'U1');
    expect(presence.leave).toHaveBeenCalledWith('issue:IP-2', 'U1');
  });

  it('onProjectMemberRemoved: dự án công khai (người đó vẫn thấy) -> không rút socket', async () => {
    const { gateway, fetchSockets } = makeGateway(null, null, true);
    await gateway.onProjectMemberRemoved({ workspaceId: 'W1', projectId: 'P1', userId: 'U1' });
    expect(fetchSockets).not.toHaveBeenCalled();
  });

  it('onProjectMemberRemoved: payload thiếu bị bỏ qua, lỗi fetchSockets bị nuốt', async () => {
    const { gateway, fetchSockets } = makeGateway(null, null, false);
    await gateway.onProjectMemberRemoved({ workspaceId: 'W1', projectId: 'P1' });
    expect(fetchSockets).not.toHaveBeenCalled();
    fetchSockets.mockRejectedValue(new Error('redis'));
    await expect(
      gateway.onProjectMemberRemoved({ workspaceId: 'W1', projectId: 'P1', userId: 'U1' }),
    ).resolves.toBeUndefined();
  });
});

describe('RealtimeGateway.onProjectVisibilityChanged (P16)', () => {
  it('rà mọi socket trong room project: rút người không còn thấy, giữ người còn thấy; mỗi người kiểm một lần', async () => {
    const { gateway, fetchSockets, access, presence } = makeGateway(
      null,
      null,
      (userId) => userId === 'U2',
    );
    const a1 = {
      data: { userId: 'U1' },
      rooms: new Set(['project:P1', 'issue:IP-1']),
      leave: vi.fn(),
    };
    const a2 = { data: { userId: 'U1' }, rooms: new Set(['project:P1']), leave: vi.fn() };
    const b = {
      data: { userId: 'U2' },
      rooms: new Set(['project:P1', 'issue:IP-1']),
      leave: vi.fn(),
    };
    fetchSockets.mockResolvedValue([a1, b, a2]);
    await gateway.onProjectVisibilityChanged({ workspaceId: 'W1', projectId: 'P1' });
    expect(a1.leave).toHaveBeenCalledWith('project:P1');
    expect(a1.leave).toHaveBeenCalledWith('issue:IP-1');
    expect(a2.leave).toHaveBeenCalledWith('project:P1');
    expect(b.leave).not.toHaveBeenCalled();
    expect(access.canSee).toHaveBeenCalledTimes(2);
    expect(presence.leave).toHaveBeenCalledWith('project:P1', 'U1');
    expect(presence.leave).not.toHaveBeenCalledWith('project:P1', 'U2');
  });

  it('payload thiếu bị bỏ qua; lỗi bị nuốt', async () => {
    const { gateway, fetchSockets } = makeGateway();
    await gateway.onProjectVisibilityChanged({ workspaceId: 'W1' });
    expect(fetchSockets).not.toHaveBeenCalled();
    fetchSockets.mockRejectedValue(new Error('redis'));
    await expect(
      gateway.onProjectVisibilityChanged({ workspaceId: 'W1', projectId: 'P1' }),
    ).resolves.toBeUndefined();
  });
});

describe('RealtimeGateway.onAccessChanged — đổi vai trò/quyền rà lại socket (S-I6/D-I1)', () => {
  const issueProjects: Record<string, string> = { 'IP-1': 'P1', 'IP-2': 'P1', 'IX-1': 'P2' };
  function setup(canSee: (userId: string, ws: string, projectId: string) => boolean) {
    const ctx = makeGateway(null, null, canSee);
    // issue.findMany dùng chung cho tra "room issue thuộc dự án nào" (mới) và "rút theo dự án" (cũ)
    ctx.prisma.issue.findMany.mockImplementation(
      (a: { where: { projectId?: string; id: { in: string[] } } }) =>
        Promise.resolve(
          a.where.id.in
            .filter(
              (id) =>
                id in issueProjects &&
                (!a.where.projectId || issueProjects[id] === a.where.projectId),
            )
            .map((id) => ({ id, projectId: issueProjects[id] })),
        ),
    );
    return ctx;
  }

  it('userIds: rà socket của đúng user; mất quyền xem P1 → rút khỏi project:P1 + issue của P1, giữ dự án còn thấy (P2)', async () => {
    const { gateway, fetchSockets, access, presence } = setup((_u, _w, p) => p !== 'P1');
    const tab1 = {
      data: { userId: 'U1' },
      rooms: new Set(['user:U1', 'project:P1', 'project:P2', 'issue:IP-1', 'issue:IX-1']),
      leave: vi.fn(),
    };
    const tab2 = {
      data: { userId: 'U1' },
      rooms: new Set(['user:U1', 'issue:IP-2']),
      leave: vi.fn(),
    };
    const other = {
      data: { userId: 'U2' },
      rooms: new Set(['user:U1', 'project:P1']),
      leave: vi.fn(),
    };
    fetchSockets.mockResolvedValue([tab1, tab2, other]);
    await gateway.onAccessChanged({ workspaceId: 'W1', userIds: ['U1'] });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('user:U1');
    expect(tab1.leave).toHaveBeenCalledWith('project:P1');
    expect(tab1.leave).toHaveBeenCalledWith('issue:IP-1');
    expect(tab1.leave).not.toHaveBeenCalledWith('project:P2');
    expect(tab1.leave).not.toHaveBeenCalledWith('issue:IX-1');
    expect(tab2.leave).toHaveBeenCalledWith('issue:IP-2'); // tab chỉ mở một việc của P1
    expect(other.leave).not.toHaveBeenCalled(); // socket của người khác (không thuộc userIds) không bị đụng
    expect(presence.leave).toHaveBeenCalledWith('project:P1', 'U1');
    // mỗi (người, dự án) kiểm một lần dù nhiều tab: P1 và P2 cho U1
    expect(access.canSee).toHaveBeenCalledTimes(2);
  });

  it('còn thấy mọi dự án → không rút socket nào', async () => {
    const { gateway, fetchSockets } = setup(() => true);
    const s = { data: { userId: 'U1' }, rooms: new Set(['project:P1']), leave: vi.fn() };
    fetchSockets.mockResolvedValue([s]);
    await gateway.onAccessChanged({ workspaceId: 'W1', userIds: ['U1'] });
    expect(s.leave).not.toHaveBeenCalled();
  });

  it('userIds vắng = cả workspace: rà mọi socket trong room ws:<id>, rút từng người mất quyền', async () => {
    const { gateway, fetchSockets } = setup((u) => u === 'U2');
    const a = { data: { userId: 'U1' }, rooms: new Set(['ws:W1', 'project:P1']), leave: vi.fn() };
    const b = { data: { userId: 'U2' }, rooms: new Set(['ws:W1', 'project:P1']), leave: vi.fn() };
    fetchSockets.mockResolvedValue([a, b]);
    await gateway.onAccessChanged({ workspaceId: 'W1' });
    const server = (gateway as unknown as { server: { in: ReturnType<typeof vi.fn> } }).server;
    expect(server.in).toHaveBeenCalledWith('ws:W1');
    expect(a.leave).toHaveBeenCalledWith('project:P1');
    expect(b.leave).not.toHaveBeenCalled();
  });

  it('payload thiếu bị bỏ qua; lỗi bị nuốt', async () => {
    const { gateway, fetchSockets } = setup(() => true);
    await gateway.onAccessChanged({});
    expect(fetchSockets).not.toHaveBeenCalled();
    fetchSockets.mockRejectedValue(new Error('redis'));
    await expect(gateway.onAccessChanged({ workspaceId: 'W1' })).resolves.toBeUndefined();
  });
});
