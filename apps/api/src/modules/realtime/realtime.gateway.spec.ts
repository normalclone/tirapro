import { describe, expect, it, vi } from 'vitest';
import { WS_EVENTS } from '@tirapro/types';
import { RealtimeGateway } from './realtime.gateway';

function makeGateway(projectRow: unknown = null) {
  const prisma = { project: { findFirst: vi.fn().mockResolvedValue(projectRow) } };
  const jwt = { verify: vi.fn() };
  const config = { get: vi.fn() };
  const gateway = new RealtimeGateway(jwt as never, config as never, prisma as never);
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  (gateway as unknown as { server: unknown }).server = { to };
  return { gateway, prisma, jwt, config, to, emit };
}

function makeClient(data: Record<string, unknown> = { userId: 'U1', workspaceId: 'W1' }) {
  return { data, join: vi.fn(), leave: vi.fn(), disconnect: vi.fn() };
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
    expect(await gateway.onSubscribe({ kind: 'user', id: 'U2' } as never, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
    expect(await gateway.onSubscribe({ kind: 'user', id: 'U1' } as never, client as never)).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('user:U1');
  });

  it('chỉ cho join room workspace của mình (đúng tên room ws:<id>)', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'workspace', id: 'W2' } as never, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(client.join).not.toHaveBeenCalled();
    expect(await gateway.onSubscribe({ kind: 'workspace', id: 'W1' } as never, client as never)).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('ws:W1');
  });

  it('từ chối loại room lạ và payload thiếu', async () => {
    const { gateway } = makeGateway();
    const client = makeClient();
    expect(await gateway.onSubscribe({ kind: 'bogus', id: 'X' } as never, client as never)).toEqual({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(await gateway.onSubscribe(undefined as never, client as never)).toEqual({ ok: false, error: 'FORBIDDEN' });
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

describe('RealtimeGateway — bridge notification & sprint', () => {
  it('notification.created -> notification:new tới room user của người nhận', () => {
    const { gateway, to, emit } = makeGateway();
    const notification = { id: 'N1', type: 'MENTIONED' };
    gateway.onNotificationCreated({ recipientId: 'U9', notification } as never);
    expect(to).toHaveBeenCalledWith('user:U9');
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.NOTIFICATION_NEW, { notification });
  });

  it('bỏ qua notification.created thiếu recipientId', () => {
    const { gateway, to } = makeGateway();
    gateway.onNotificationCreated({ notification: { id: 'N1' } } as never);
    expect(to).not.toHaveBeenCalled();
  });

  it.each(['onSprintStarted', 'onSprintCompleted', 'onSprintUpdated'] as const)(
    '%s -> sprint:updated tới room project',
    (method) => {
      const { gateway, to, emit } = makeGateway();
      gateway[method]({ sprintId: 'S1', projectId: 'P1' });
      expect(to).toHaveBeenCalledWith('project:P1');
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.SPRINT_UPDATED, { sprintId: 'S1', projectId: 'P1' });
    },
  );
});
