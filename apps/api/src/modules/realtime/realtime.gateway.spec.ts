import { describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '@tirapro/types';
import { RealtimeGateway } from './realtime.gateway';

function makeGateway(projectRow: unknown = null, issueRow: unknown = null) {
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue(projectRow) },
    issue: { findFirst: vi.fn().mockResolvedValue(issueRow) },
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
  const gateway = new RealtimeGateway(
    jwt as never,
    config as never,
    prisma as never,
    presence as never,
  );
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  const fetchSockets = vi.fn().mockResolvedValue([]);
  const inRoom = vi.fn().mockReturnValue({ fetchSockets });
  (gateway as unknown as { server: unknown }).server = { to, in: inRoom };
  return { gateway, prisma, presence, jwt, config, to, emit, fetchSockets };
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
    expect(client.join).not.toHaveBeenCalled();
  });

  it('từ chối user DEACTIVATED dù còn membership', async () => {
    const { gateway, client } = connect(
      { status: 'DEACTIVATED', isSystemAdmin: false },
      { id: 'M1' },
    );
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
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
    const ok = makeGateway(null, { id: 'I1' });
    const client = makeClient();
    expect(await ok.gateway.onSubscribe({ kind: 'issue', id: 'I1' }, client as never)).toEqual({
      ok: true,
    });
    expect(client.join).toHaveBeenCalledWith('issue:I1');
    expect(ok.prisma.issue.findFirst).toHaveBeenCalledWith({
      where: { id: 'I1', workspaceId: 'W1', deletedAt: null },
      select: { id: true },
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
