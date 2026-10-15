import { describe, expect, it, vi } from 'vitest';
import { IntegrationsService } from './integrations.service';

const integ = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  workspaceId: 'w1',
  type: 'TELEGRAM',
  name: 'n',
  config: { botToken: 'x' },
  status: 'ACTIVE',
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  channels: [{ externalId: 'c1', events: [], projectId: null, isEnabled: true }],
  ...over,
});

function setup(
  resolution: { kind: 'global' } | { kind: 'own'; token: string } | { kind: 'unusable' },
  row = integ(),
) {
  const prisma = {
    integration: {
      findMany: vi.fn(() => Promise.resolve([row])),
      findFirst: vi.fn(() => Promise.resolve(row)),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      create: vi.fn(() => Promise.resolve(row)),
      delete: vi.fn(() => Promise.resolve(row)),
    },
    integrationChannel: { findMany: vi.fn(() => Promise.resolve(row.channels)) },
  };
  const audit = { record: vi.fn() };
  const telegram = {
    resolveBotToken: vi.fn(() => resolution),
    send: vi.fn(() => Promise.resolve(true)),
    available: vi.fn(() => true),
  };
  return {
    service: new IntegrationsService(prisma as never, telegram as never, audit as never),
    prisma,
    telegram,
    audit,
  };
}
const payload = {
  issue: { workspaceId: 'w1', key: 'P-1', summary: 's', projectId: 'p1', status: { name: 'Done' } },
};

describe('IntegrationsService — token không dùng được', () => {
  it('fanout: unusable → KHÔNG gửi (không rơi về bot toàn cục), đánh dấu ERROR có điều kiện ACTIVE', async () => {
    const { service, prisma, telegram } = setup({ kind: 'unusable' });
    await service.onIssueUpdated(payload);
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'ACTIVE' },
      data: { status: 'ERROR' },
    });
  });

  it('fanout: own → gửi bằng token riêng; global → gửi với token null', async () => {
    const own = setup({ kind: 'own', token: 'T' });
    await own.service.onIssueUpdated(payload);
    expect(own.telegram.send).toHaveBeenCalledWith('T', 'c1', expect.any(String));
    const glob = setup({ kind: 'global' });
    await glob.service.onIssueUpdated(payload);
    expect(glob.telegram.send).toHaveBeenCalledWith(null, 'c1', expect.any(String));
  });

  it('test(): unusable → 422 nêu rõ token không dùng được, không gửi, đặt ERROR', async () => {
    const { service, prisma, telegram } = setup({ kind: 'unusable' });
    await expect(service.test('w1', 'g1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('không dùng được') as unknown,
    });
    expect(telegram.send).not.toHaveBeenCalled();
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'ACTIVE' },
      data: { status: 'ERROR' },
    });
  });

  it('test(): token dùng được và đang ERROR → tự phục hồi về ACTIVE', async () => {
    const { service, prisma } = setup({ kind: 'own', token: 'T' }, integ({ status: 'ERROR' }));
    await service.test('w1', 'g1');
    expect(prisma.integration.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'ERROR' },
      data: { status: 'ACTIVE' },
    });
  });
});

describe('IntegrationsService — ghi nhật ký quản trị', () => {
  it('createTelegram(): ghi integration.created, KHÔNG đưa botToken vào nhật ký', async () => {
    const { service, audit, telegram } = setup({ kind: 'global' });
    (telegram as unknown as Record<string, unknown>).encrypt = vi.fn(() => 'ENCRYPTED');
    await service.createTelegram('w1', 'u1', { name: 'Bot QA', botToken: '123:SECRET' });
    const entry = audit.record.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'integration.created',
      entityType: 'integration',
    });
    expect(JSON.stringify(entry)).not.toContain('SECRET');
    expect(JSON.stringify(entry)).not.toContain('ENCRYPTED');
  });

  it('remove(): ghi integration.deleted với người thực hiện', async () => {
    const { service, audit } = setup({ kind: 'global' });
    await service.remove('w1', 'g1', 'u1');
    expect(audit.record.mock.calls[0]![0]).toMatchObject({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'integration.deleted',
      entityId: 'g1',
    });
  });
});
