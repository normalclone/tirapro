import { describe, expect, it, vi } from 'vitest';
import { RulesService } from './rules.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  workspaceId: 'w1',
  projectId: null,
  name: 'r',
  enabled: true,
  trigger: 'ISSUE_CREATED',
  triggerConfig: {},
  conditions: [],
  actions: [{ type: 'assign', mode: 'lead' }],
  createdById: 'u1',
  lastRunAt: null,
  runCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function setup() {
  const prisma = {
    automationRule: {
      findMany: vi.fn(() =>
        Promise.resolve([
          row(),
          row({ id: 'r2', projectId: 'p2' }),
          row({ id: 'r3', trigger: 'COMMENT_ADDED' }),
        ]),
      ),
      findFirst: vi.fn(() => Promise.resolve(row())),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row(data))),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
  };
  const redis = { isAvailable: () => false, getClient: () => null };
  return { service: new RulesService(prisma as never, redis as never), prisma };
}

describe('RulesService', () => {
  it('activeFor lọc theo trigger + dự án (null = cả workspace) và cache bộ nhớ 60s đến khi invalidate', async () => {
    const { service, prisma } = setup();
    const a = await service.activeFor('w1', 'ISSUE_CREATED', 'p1');
    expect(a.map((r) => r.id)).toEqual(['r1']); // r2 thuộc dự án khác, r3 khác trigger
    await service.activeFor('w1', 'ISSUE_CREATED', 'p2');
    expect(prisma.automationRule.findMany).toHaveBeenCalledTimes(1); // lần 2 từ cache

    await service.remove('w1', 'r1'); // đổi quy tắc => xoá cache
    const b = await service.activeFor('w1', 'ISSUE_CREATED', 'p2');
    expect(prisma.automationRule.findMany).toHaveBeenCalledTimes(2);
    expect(b.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('create/update cũng xoá cache', async () => {
    const { service, prisma } = setup();
    await service.activeFor('w1', 'ISSUE_CREATED', 'p1');
    await service.create('w1', 'u1', {
      name: 'n',
      trigger: 'ISSUE_CREATED',
      triggerConfig: {},
      conditions: [],
      actions: [{ type: 'assign', mode: 'lead' }],
    });
    await service.activeFor('w1', 'ISSUE_CREATED', 'p1');
    await service.update('w1', 'r1', { enabled: false });
    await service.activeFor('w1', 'ISSUE_CREATED', 'p1');
    expect(prisma.automationRule.findMany).toHaveBeenCalledTimes(3);
  });

  it('SCHEDULED: cần cron hợp lệ và điều kiện JQL', async () => {
    const { service } = setup();
    const base = {
      name: 'n',
      trigger: 'SCHEDULED' as const,
      actions: [{ type: 'assign' as const, mode: 'lead' as const }],
    };
    await expect(
      service.create('w1', 'u1', {
        ...base,
        triggerConfig: {},
        conditions: [{ jql: 'priority = High' }],
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(
      service.create('w1', 'u1', {
        ...base,
        triggerConfig: { cron: 'bậy bạ' },
        conditions: [{ jql: 'priority = High' }],
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(
      service.create('w1', 'u1', {
        ...base,
        triggerConfig: { cron: '0 9 * * 1-5' },
        conditions: [],
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
    await expect(
      service.create('w1', 'u1', {
        ...base,
        triggerConfig: { cron: '0 9 * * 1-5' },
        conditions: [{ jql: 'priority = High' }],
      }),
    ).resolves.toMatchObject({ trigger: 'SCHEDULED' });
  });

  it('JQL sai cú pháp bị từ chối khi lưu', async () => {
    const { service } = setup();
    await expect(
      service.create('w1', 'u1', {
        name: 'n',
        trigger: 'ISSUE_CREATED',
        triggerConfig: {},
        conditions: [{ jql: 'priority = = =' }],
        actions: [{ type: 'assign', mode: 'lead' }],
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE_VIOLATION' });
  });
});
