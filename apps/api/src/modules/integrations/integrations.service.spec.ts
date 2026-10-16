import { describe, expect, it, vi } from 'vitest';
import { IntegrationsService } from './integrations.service';
import { TelegramUnreachableError } from './telegram.service';
import { createTelegramSchema } from './integrations.controller';

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
      update: vi.fn(() => Promise.resolve(row)),
      delete: vi.fn(() => Promise.resolve(row)),
    },
    $executeRaw: vi.fn((..._a: unknown[]) => Promise.resolve(1)),
    // Mặc định dự án công khai (findFirst với isPrivate:true không khớp); ca riêng tư đặt lại.
    project: { findFirst: vi.fn((..._a: unknown[]): Promise<unknown> => Promise.resolve(null)) },
    integrationChannel: { findMany: vi.fn(() => Promise.resolve(row.channels)) },
  };
  const audit = { record: vi.fn() };
  const access = {
    assertCanSee: vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve()),
    canSee: vi.fn((..._a: unknown[]): Promise<boolean> => Promise.resolve(true)),
  };
  const telegram = {
    resolveBotToken: vi.fn(() => resolution),
    send: vi.fn(() => Promise.resolve(true)),
    available: vi.fn(() => true),
    platformEnabled: vi.fn(() => true),
    getMe: vi.fn(() => Promise.resolve({ id: 1, username: 'tira_bot', firstName: 'Tira' })),
    globalBotUsername: vi.fn(() => Promise.resolve('global_bot')),
    encrypt: vi.fn((t: string) => `ENC(${t})`),
  };
  return {
    service: new IntegrationsService(
      prisma as never,
      telegram as never,
      audit as never,
      access as never,
    ),
    prisma,
    telegram,
    audit,
    access,
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
    telegram.encrypt.mockReturnValue('ENCRYPTED');
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

describe('IntegrationsService.createTelegram — xác thực token', () => {
  it('token sai (getMe → null) → BusinessRuleException, KHÔNG tạo integration, KHÔNG ghi nhật ký', async () => {
    const { service, prisma, telegram, audit } = setup({ kind: 'global' });
    telegram.getMe.mockResolvedValue(null as never);
    await expect(
      service.createTelegram('w1', 'u1', { name: 'n', botToken: 'bad' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Token bot không hợp lệ') as unknown,
    });
    expect(prisma.integration.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lỗi mạng tới Telegram → thông điệp riêng (không nói token sai), không lưu', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    telegram.getMe.mockRejectedValue(new TelegramUnreachableError());
    await expect(
      service.createTelegram('w1', 'u1', { name: 'n', botToken: '1:A' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Không kết nối được tới Telegram') as unknown,
    });
    expect(prisma.integration.create).not.toHaveBeenCalled();
  });

  it('không token + không bot chung → 422 "Hệ thống chưa có bot chung", không lưu', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' });
    telegram.available.mockReturnValue(false);
    await expect(service.createTelegram('w1', 'u1', { name: 'n' })).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Hệ thống chưa có bot chung') as unknown,
    });
    expect(prisma.integration.create).not.toHaveBeenCalled();
    expect(telegram.getMe).not.toHaveBeenCalled();
  });

  it('token hợp lệ → lưu botUsername (không phải bí mật) vào config cùng token đã mã hoá', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.createTelegram('w1', 'u1', { name: 'n', botToken: '1:A' });
    const data = (
      prisma.integration.create.mock.calls[0] as unknown as [{ data: { config: unknown } }]
    )[0].data;
    expect(data.config).toEqual({
      botToken: 'ENC(1:A)',
      useGlobal: false,
      botUsername: 'tira_bot',
    });
  });

  it('không token + có bot chung → useGlobal, lưu username bot chung nếu lấy được', async () => {
    const { service, prisma } = setup({ kind: 'global' });
    await service.createTelegram('w1', 'u1', { name: 'n' });
    const data = (
      prisma.integration.create.mock.calls[0] as unknown as [{ data: { config: unknown } }]
    )[0].data;
    expect(data.config).toEqual({ botToken: null, useGlobal: true, botUsername: 'global_bot' });
  });
});

describe('IntegrationsService.test — nguyên nhân rõ ràng + lastTest', () => {
  it('0 kênh bật → reason NO_CHANNEL, không gửi', async () => {
    const row = integ({ channels: [] });
    const { service, telegram } = setup({ kind: 'own', token: 'T' }, row);
    await expect(service.test('w1', 'g1')).resolves.toMatchObject({
      reason: 'NO_CHANNEL',
      ok: false,
      total: 0,
      sent: 0,
    });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('không có bot (không token riêng, không bot chung) → reason NO_BOT', async () => {
    const { service, telegram } = setup({ kind: 'global' });
    telegram.available.mockReturnValue(false);
    await expect(service.test('w1', 'g1')).resolves.toMatchObject({ reason: 'NO_BOT', ok: false });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('hệ thống tắt tích hợp → reason PLATFORM_OFF', async () => {
    const { service, telegram } = setup({ kind: 'own', token: 'T' });
    telegram.platformEnabled.mockReturnValue(false);
    await expect(service.test('w1', 'g1')).resolves.toMatchObject({ reason: 'PLATFORM_OFF' });
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('gửi 1/2 → ok:false và ghi lastTest vào config', async () => {
    const row = integ({
      channels: [
        { externalId: 'c1', events: [], projectId: null, isEnabled: true },
        { externalId: 'c2', events: [], projectId: null, isEnabled: true },
      ],
    });
    const { service, prisma, telegram } = setup({ kind: 'own', token: 'T' }, row);
    telegram.send.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await service.test('w1', 'g1');
    expect(res).toMatchObject({ ok: false, sent: 1, total: 2 });
    // Ghi nguyên tử riêng khoá lastTest (jsonb_set), KHÔNG đọc-sửa-ghi cả config.
    expect(prisma.integration.update).not.toHaveBeenCalled();
    const call = prisma.$executeRaw.mock.calls[0] as unknown as [string[], string, string, string];
    expect(call[0].join('?')).toContain('jsonb_set');
    const lastTest = JSON.parse(call[1]) as Record<string, unknown>;
    expect(lastTest).toMatchObject({ ok: false, sent: 1, total: 2 });
    expect(typeof lastTest.at).toBe('string');
    expect(call[2]).toBe('g1');
    expect(call[3]).toBe('w1');
  });

  it('gửi đủ 2/2 → ok:true', async () => {
    const row = integ({
      channels: [
        { externalId: 'c1', events: [], projectId: null, isEnabled: true },
        { externalId: 'c2', events: [], projectId: null, isEnabled: true },
      ],
    });
    const { service } = setup({ kind: 'own', token: 'T' }, row);
    await expect(service.test('w1', 'g1')).resolves.toMatchObject({ ok: true, sent: 2, total: 2 });
  });
});

describe('IntegrationsService.list — health tính lúc đọc', () => {
  it('kết nối cũ (0 kênh bật) → NO_CHANNEL; botToken luôn bị che; có botUsername/lastTest', async () => {
    const row = {
      ...integ({
        config: {
          botToken: 'SECRETCIPHER',
          useGlobal: false,
          botUsername: 'tira_bot',
          lastTest: { at: '2026-10-15T09:12:00.000Z', ok: true, sent: 2, total: 2 },
        },
      }),
      _count: { channels: 0 },
    };
    const { service } = setup({ kind: 'own', token: 'T' }, row);
    const [dto] = await service.list('w1');
    expect(dto!.health?.state).toBe('NO_CHANNEL');
    expect(dto!.botUsername).toBe('tira_bot');
    expect(dto!.lastTest).toEqual({ at: '2026-10-15T09:12:00.000Z', ok: true, sent: 2, total: 2 });
    expect(JSON.stringify(dto)).not.toContain('SECRETCIPHER');
  });

  it('kết nối cũ không token và không bot chung → NO_BOT', async () => {
    const row = {
      ...integ({ config: { botToken: null, useGlobal: true } }),
      _count: { channels: 1 },
    };
    const { service, telegram } = setup({ kind: 'global' }, row);
    telegram.available.mockReturnValue(false);
    const [dto] = await service.list('w1');
    expect(dto!.health?.state).toBe('NO_BOT');
    expect(dto!.botUsername).toBeNull();
    expect(dto!.lastTest).toBeNull();
  });

  it('platform(): trả cờ hệ thống + bot chung', async () => {
    const { service } = setup({ kind: 'global' });
    await expect(service.platform()).resolves.toEqual({
      platformEnabled: true,
      globalBotAvailable: true,
      globalBotUsername: 'global_bot',
    });
  });
});

describe('IntegrationsService.list — health chỉ cho Telegram', () => {
  it('kết nối loại khác (GITHUB) → health null, không gán nhãn "Chưa có bot"', async () => {
    const row = { ...integ({ type: 'GITHUB', config: {} }), _count: { channels: 0 } };
    const { service } = setup({ kind: 'global' }, row);
    const [dto] = await service.list('w1');
    expect(dto!.health).toBeNull();
  });
});

describe('createTelegramSchema — hình dạng token ở server', () => {
  const good = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  it('token đúng dạng (có trim) hợp lệ; không token vẫn hợp lệ', () => {
    expect(createTelegramSchema.safeParse({ name: 'n', botToken: `  ${good} ` })).toMatchObject({
      success: true,
      data: { botToken: good },
    });
    expect(createTelegramSchema.safeParse({ name: 'n' }).success).toBe(true);
  });
  it.each([
    'hello',
    '123456789',
    '123456789:short',
    `${good}/../x`,
    '12:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    'a b',
  ])('từ chối token lạ %s', (bad) => {
    expect(createTelegramSchema.safeParse({ name: 'n', botToken: bad }).success).toBe(false);
  });
});

describe('IntegrationsService.fanout — dự án riêng tư (P16)', () => {
  const ch = (over: Record<string, unknown>) => ({
    externalId: 'c1',
    events: [],
    projectId: null,
    isEnabled: true,
    ...over,
  });

  it('dự án riêng tư: kênh cấp workspace KHÔNG nhận; kênh gắn đúng dự án đó thì nhận', async () => {
    const row = integ({
      channels: [
        ch({ externalId: 'ws-wide', projectId: null }),
        ch({ externalId: 'bound', projectId: 'p1' }),
      ],
    });
    const { service, prisma, telegram } = setup({ kind: 'global' }, row);
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    await service.onIssueUpdated(payload);
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send).toHaveBeenCalledWith(null, 'bound', expect.any(String));
    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', workspaceId: 'w1', deletedAt: null, isPrivate: true },
      }),
    );
  });

  it('dự án công khai: kênh cấp workspace vẫn nhận như cũ', async () => {
    const row = integ({ channels: [ch({ externalId: 'ws-wide' })] });
    const { service, telegram } = setup({ kind: 'global' }, row);
    await service.onIssueUpdated(payload);
    expect(telegram.send).toHaveBeenCalledWith(null, 'ws-wide', expect.any(String));
  });

  it('bình luận mới của dự án riêng tư cũng đi qua cùng lọc', async () => {
    const row = integ({ channels: [ch({ externalId: 'ws-wide' })] });
    const { service, prisma, telegram } = setup({ kind: 'global' }, row);
    (prisma as Record<string, unknown>).issue = {
      findUnique: vi.fn(() =>
        Promise.resolve({ workspaceId: 'w1', key: 'P-1', summary: 's', projectId: 'p1' }),
      ),
    };
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    await service.onCommentAdded({ issueId: 'i1' });
    expect(telegram.send).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService.addChannel — gắn kênh vào dự án riêng tư', () => {
  it('người gắn không thấy dự án → 404, KHÔNG tạo kênh', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    (prisma.integrationChannel as unknown as { create: unknown }).create = vi.fn();
    access.assertCanSee.mockRejectedValue(Object.assign(new Error('Dự án'), { status: 404 }));
    await expect(
      service.addChannel('w1', 'g1', { externalId: '-100', projectId: 'pHidden' }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'w1', 'pHidden');
    expect(
      (prisma.integrationChannel as unknown as { create: { mock: { calls: unknown[] } } }).create
        .mock.calls,
    ).toHaveLength(0);
  });

  it('người thấy dự án → tạo kênh gắn dự án; kênh cấp workspace (không dự án) không cần kiểm', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    const create = vi.fn((a: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'c1', ...a.data }),
    );
    (prisma.integrationChannel as unknown as { create: unknown }).create = create;
    await service.addChannel('w1', 'g1', { externalId: '-100', projectId: 'p1' }, 'u1');
    expect(create.mock.calls[0]![0].data).toMatchObject({ projectId: 'p1' });
    access.assertCanSee.mockClear();
    await service.addChannel('w1', 'g1', { externalId: '-101' }, 'u1');
    expect(access.assertCanSee).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService — sửa hàng loạt không spam kênh (D-I2)', () => {
  const ch = { externalId: 'c1', events: [], projectId: null, isEnabled: true };

  it('ISSUE_UPDATED có bulk: true (hệ thống) hoặc batch (người dùng) => không gửi tin nào', async () => {
    const { service, telegram } = setup({ kind: 'global' }, integ({ channels: [ch] }));
    await service.onIssueUpdated({ ...payload, bulk: true });
    await service.onIssueUpdated({ ...payload, batch: { id: 'b1', size: 30 } });
    expect(telegram.send).not.toHaveBeenCalled();
    await service.onIssueUpdated(payload);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('ISSUES_BULK_UPDATED => MỘT tin gộp "N việc … cập nhật bởi X" tới mỗi kênh của dự án', async () => {
    const { service, prisma, telegram } = setup({ kind: 'global' }, integ({ channels: [ch] }));
    (prisma as Record<string, unknown>).user = {
      findUnique: vi.fn(() => Promise.resolve({ displayName: 'Phúc' })),
    };
    prisma.project.findFirst.mockImplementation((a: unknown) =>
      Promise.resolve((a as { select?: { key?: boolean } }).select?.key ? { key: 'DEMO' } : null),
    );
    await service.onIssuesBulkUpdated({
      workspaceId: 'w1',
      projectId: 'p1',
      actorId: 'u1',
      count: 30,
    });
    expect(telegram.send).toHaveBeenCalledTimes(1);
    const text = (telegram.send.mock.calls[0] as unknown as [unknown, string, string])[2];
    expect(text).toContain('30');
    expect(text).toContain('DEMO');
    expect(text).toContain('Phúc');
  });
});

describe('IntegrationsService — dự án chuyển riêng tư tắt kênh gắn dự án (S-I5)', () => {
  const evt = { workspaceId: 'w1', projectId: 'p1', isPrivate: true, actorId: 'u1' };

  it('sang riêng tư: tắt MỌI kênh đang bật gắn đúng dự án + ghi nhật ký với số kênh', async () => {
    const { service, prisma, audit } = setup({ kind: 'global' });
    const channel = {
      findMany: vi.fn((..._a: unknown[]) => Promise.resolve([{ id: 'c1' }, { id: 'c2' }])),
      updateMany: vi.fn((..._a: unknown[]) => Promise.resolve({ count: 2 })),
    };
    (prisma as Record<string, unknown>).integrationChannel = channel;
    await service.onProjectVisibilityChanged(evt);
    expect(channel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', projectId: 'p1', isEnabled: true },
      }),
    );
    expect(channel.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] } },
      data: { isEnabled: false },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.channels_disabled',
        workspaceId: 'w1',
        entityId: 'p1',
        meta: expect.objectContaining({ count: 2 }) as unknown,
      }),
    );
  });

  it('mở công khai trở lại (isPrivate=false) hoặc không có kênh => không đụng kênh, không ghi nhật ký', async () => {
    const { service, prisma, audit } = setup({ kind: 'global' });
    const channel = {
      findMany: vi.fn((..._a: unknown[]) => Promise.resolve([])),
      updateMany: vi.fn((..._a: unknown[]) => Promise.resolve({ count: 0 })),
    };
    (prisma as Record<string, unknown>).integrationChannel = channel;
    await service.onProjectVisibilityChanged({ ...evt, isPrivate: false });
    expect(channel.findMany).not.toHaveBeenCalled();
    await service.onProjectVisibilityChanged(evt);
    expect(channel.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('IntegrationsService.listChannels/removeChannel — kênh của dự án riêng tư (S-minor)', () => {
  const rows = [
    { id: 'c-ws', externalId: 'a', projectId: null },
    { id: 'c-pub', externalId: 'b', projectId: 'pPublic' },
    { id: 'c-hid', externalId: 'c', projectId: 'pHidden' },
  ];

  it('liệt kê: ẩn kênh gắn dự án người xem không thấy; kênh cấp workspace/dự án thấy được vẫn hiện', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    prisma.integrationChannel.findMany.mockResolvedValue(rows as never);
    access.canSee.mockImplementation((_u: unknown, _w: unknown, p: unknown) =>
      Promise.resolve(p !== 'pHidden'),
    );
    const out = await service.listChannels('w1', 'g1', 'u1');
    expect(out.map((c) => c.id)).toEqual(['c-ws', 'c-pub']);
  });

  it('gỡ kênh của dự án riêng tư người gọi không thấy => 404, không xoá', async () => {
    const { service, prisma, access } = setup({ kind: 'global' });
    const del = vi.fn();
    (prisma.integrationChannel as unknown as Record<string, unknown>).findFirst = vi.fn(() =>
      Promise.resolve({
        id: 'c-hid',
        title: null,
        externalId: 'c',
        integrationId: 'g1',
        projectId: 'pHidden',
      }),
    );
    (prisma.integrationChannel as unknown as Record<string, unknown>).delete = del;
    access.canSee.mockResolvedValue(false);
    await expect(service.removeChannel('w1', 'c-hid', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(del).not.toHaveBeenCalled();
  });
});
