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

const cipher = {
  // Giả dạng ba phần iv:tag:ct như TelegramService thật (openSecret kiểm đúng 3 phần).
  encrypt: (p: string) => `i:t:${p}`,
  decrypt: (e: string) => (e.startsWith('i:t:') ? e.slice(4) : null),
};

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
      findFirst: vi.fn((..._a: unknown[]) => Promise.resolve(row())),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row(data))),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: null as Date | null })),
    },
  };
  const redis = { isAvailable: () => false, getClient: () => null };
  return { service: new RulesService(prisma as never, redis as never, cipher as never), prisma };
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

  type Written = [{ data: { actions: Array<{ secret: string }> } }];

  it('create: secret webhook được mã hoá khi ghi DB và bị che trong response', async () => {
    const { service, prisma } = setup();
    const dto = await service.create('w1', 'u1', {
      name: 'n',
      trigger: 'ISSUE_CREATED',
      triggerConfig: {},
      conditions: [],
      actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'k' }],
    });
    const stored = (prisma.automationRule.create.mock.calls[0] as unknown as Written)[0].data
      .actions[0]!.secret;
    expect(stored).toBe('enc:v1:i:t:k');
    expect((dto.actions[0] as { secret?: string }).secret).toBe('********');
  });

  it('update: gửi lại ******** giữ khoá cũ; gửi khoá mới thì mã hoá lại', async () => {
    const { service, prisma } = setup();
    prisma.automationRule.findFirst.mockResolvedValue(
      row({ actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'enc:v1:i:t:old' }] }),
    );
    await service.update('w1', 'r1', {
      actions: [{ type: 'webhook', url: 'https://x.test/h', secret: '********' }],
    });
    expect(
      (prisma.automationRule.updateMany.mock.calls[0] as unknown as Written)[0].data.actions[0]!
        .secret,
    ).toBe('enc:v1:i:t:old');
    await service.update('w1', 'r1', {
      actions: [{ type: 'webhook', url: 'https://x.test/h', secret: 'moi' }],
    });
    expect(
      (prisma.automationRule.updateMany.mock.calls[1] as unknown as Written)[0].data.actions[0]!
        .secret,
    ).toBe('enc:v1:i:t:moi');
  });

  it('cache engine chỉ chứa bản đã mã hoá; openSecret giải mã được cả bản mã hoá lẫn plaintext cũ', () => {
    const { service } = setup();
    expect(service.openSecret('enc:v1:i:t:k')).toBe('k');
    expect(service.openSecret('plain-cu')).toBe('plain-cu');
  });
});

describe('RulesService — dự án lưu trữ là chỉ đọc', () => {
  const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };
  const input = {
    name: 'n',
    projectId: 'p1',
    trigger: 'ISSUE_CREATED',
    triggerConfig: {},
    conditions: [],
    actions: [{ type: 'assign', mode: 'lead' }],
  } as never;

  function archivedSetup() {
    const s = setup();
    s.prisma.project.findUnique.mockResolvedValue({ archivedAt: new Date() });
    s.prisma.automationRule.findFirst.mockResolvedValue(row({ projectId: 'p1' }));
    return s;
  }

  it('create/update/remove quy tắc của dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = archivedSetup();
    await expect(service.create('w1', 'u1', input)).rejects.toMatchObject(ARCHIVED);
    await expect(service.update('w1', 'r1', { enabled: false })).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'r1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.automationRule.create).not.toHaveBeenCalled();
    expect(prisma.automationRule.updateMany).not.toHaveBeenCalled();
    expect(prisma.automationRule.deleteMany).not.toHaveBeenCalled();
  });

  it('quy tắc cả workspace (không gắn dự án) vẫn sửa/xoá được', async () => {
    const { service, prisma } = archivedSetup();
    prisma.automationRule.findFirst.mockResolvedValue(row({ projectId: null }));
    await service.update('w1', 'r1', { enabled: false });
    await service.remove('w1', 'r1');
    expect(prisma.automationRule.updateMany).toHaveBeenCalled();
    expect(prisma.automationRule.deleteMany).toHaveBeenCalled();
  });
});
