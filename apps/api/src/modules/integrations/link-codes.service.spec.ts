import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IntegrationsService } from './integrations.service';
import { LINK_CODE_ALPHABET, LinkCodesService } from './link-codes.service';
import {
  TelegramTokenRejectedError,
  TelegramService,
  TelegramUnreachableError,
  TelegramWebhookConflictError,
} from './telegram.service';

describe('LinkCodesService — Nest DI', () => {
  it('dựng được qua Nest DI (mọi tham số constructor đều là provider)', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        LinkCodesService,
        { provide: PrismaService, useValue: {} },
        { provide: TelegramService, useValue: {} },
        { provide: IntegrationsService, useValue: {} },
      ],
    }).compile();
    expect(mod.get(LinkCodesService)).toBeInstanceOf(LinkCodesService);
  });
});

const NOW = new Date('2026-10-16T10:00:00.000Z');
const future = new Date(NOW.getTime() + 10 * 60_000);
const past = new Date(NOW.getTime() - 60_000);

const integration = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  workspaceId: 'w1',
  type: 'TELEGRAM',
  name: 'n',
  config: { botToken: 'ENC', useGlobal: false, botUsername: 'TiraproBot' },
  status: 'ACTIVE',
  ...over,
});

const tokenRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  token: 'K7M2QX',
  workspaceId: 'w1',
  projectId: null,
  integrationId: 'g1',
  createdById: 'u1',
  expiresAt: future,
  consumedAt: null,
  ...over,
});

const groupUpdate = (text: string, over: Record<string, unknown> = {}) => ({
  chatId: -100123,
  chatType: 'supergroup',
  chatTitle: 'Dev team',
  text,
  date: 1,
  ...over,
});

function setup(opts: { integration?: unknown; token?: unknown; updates?: unknown[] } = {}) {
  const prisma = {
    integration: {
      findFirst: vi.fn(() =>
        Promise.resolve(opts.integration === undefined ? integration() : opts.integration),
      ),
    },
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    workspace: { findUnique: vi.fn(() => Promise.resolve({ name: 'Công ty A' })) },
    channelLinkToken: {
      findFirst: vi.fn(() => Promise.resolve(opts.token === undefined ? tokenRow() : opts.token)),
      count: vi.fn(() => Promise.resolve(0)),
      create: vi.fn((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', ...a.data }),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    integrationChannel: { findFirst: vi.fn(() => Promise.resolve(null)) },
  };
  const telegram = {
    resolveBotToken: vi.fn((): { kind: string; token?: string } => ({ kind: 'own', token: 'T' })),
    available: vi.fn(() => true),
    recentUpdates: vi.fn(() => Promise.resolve(opts.updates ?? [])),
    send: vi.fn(() => Promise.resolve(true)),
    globalBotUsername: vi.fn(() => Promise.resolve('global_bot')),
  };
  const integrations = {
    addChannel: vi.fn((_w: string, _i: string, input: { externalId: string; title?: string }) =>
      Promise.resolve({ id: 'c1', externalId: input.externalId, title: input.title ?? null }),
    ),
    reportUnusableToken: vi.fn(() => Promise.resolve()),
  };
  const service = new LinkCodesService(prisma as never, telegram as never, integrations as never);
  service.clock = () => NOW;
  return { service, prisma, telegram, integrations };
}

describe('createCode', () => {
  it('tạo mã 6 ký tự đúng bảng chữ, hạn +15 phút, trả lệnh + link thêm bot vào nhóm', async () => {
    const { service, prisma } = setup();
    const res = await service.createCode('w1', 'g1', 'u1');
    expect(res.code).toMatch(new RegExp(`^[${LINK_CODE_ALPHABET}]{6}$`));
    expect(res.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());
    expect(res.botUsername).toBe('TiraproBot');
    expect(res.command).toBe(`/link@TiraproBot ${res.code}`);
    expect(res.startGroupUrl).toBe('https://t.me/TiraproBot?startgroup=true');
    expect(prisma.channelLinkToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'w1',
        integrationId: 'g1',
        createdById: 'u1',
        integrationType: 'TELEGRAM',
        projectId: null,
      }) as unknown,
    });
  });

  it('bảng chữ không có ký tự nhập nhằng (0 O 1 I L)', () => {
    expect(LINK_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(LINK_CODE_ALPHABET).toHaveLength(31);
  });

  it('từ chối khi đã có 5 mã còn hiệu lực', async () => {
    const { service, prisma } = setup();
    prisma.channelLinkToken.count.mockResolvedValue(5);
    await expect(service.createCode('w1', 'g1', 'u1')).rejects.toMatchObject({ status: 422 });
    expect(prisma.channelLinkToken.create).not.toHaveBeenCalled();
    expect(prisma.channelLinkToken.count).toHaveBeenCalledWith({
      where: {
        integrationId: 'g1',
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
    });
  });

  it('dọn mã hết hạn/đã dùng quá 1 ngày của integration', async () => {
    const { service, prisma } = setup();
    await service.createCode('w1', 'g1', 'u1');
    const dayAgo = new Date(NOW.getTime() - 24 * 3600_000);
    expect(prisma.channelLinkToken.deleteMany).toHaveBeenCalledWith({
      where: {
        integrationId: 'g1',
        OR: [{ expiresAt: { lt: dayAgo } }, { consumedAt: { lt: dayAgo } }],
      },
    });
  });

  it('không tìm thấy integration (hoặc workspace khác) → 404', async () => {
    const { service } = setup({ integration: null });
    await expect(service.createCode('w1', 'gX', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('chưa biết tên bot → lệnh không có @, không có link thêm bot', async () => {
    const { service, telegram } = setup({
      integration: integration({ config: { botToken: null, useGlobal: true } }),
    });
    telegram.globalBotUsername.mockResolvedValue(null as never);
    const res = await service.createCode('w1', 'g1', 'u1');
    expect(res.botUsername).toBeNull();
    expect(res.command).toBe(`/link ${res.code}`);
    expect(res.startGroupUrl).toBeNull();
  });

  it('projectId không thuộc workspace → 404, không tạo mã', async () => {
    const { service, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue(null as never);
    await expect(service.createCode('w1', 'g1', 'u1', 'pX')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.channelLinkToken.create).not.toHaveBeenCalled();
  });
});

describe('poll', () => {
  it('bản tin khớp → tiêu thụ mã bằng CAS, tạo kênh externalId=String(chat.id), trả linked, bot xác nhận trong nhóm', async () => {
    const { service, prisma, integrations, telegram } = setup({
      updates: [groupUpdate('hello'), groupUpdate('/link@TiraproBot K7M2QX')],
    });
    const res = await service.poll('w1', 'g1', 'k7m2qx');
    expect(res).toEqual({
      status: 'linked',
      channel: { id: 'c1', externalId: '-100123', title: 'Dev team' },
    });
    expect(prisma.channelLinkToken.updateMany).toHaveBeenCalledWith({
      where: {
        token: 'K7M2QX',
        integrationId: 'g1',
        workspaceId: 'w1',
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { consumedAt: NOW },
    });
    expect(integrations.addChannel).toHaveBeenCalledWith(
      'w1',
      'g1',
      expect.objectContaining({ externalId: '-100123', title: 'Dev team' }),
      'u1',
    );
    expect(telegram.send).toHaveBeenCalledWith(
      'T',
      '-100123',
      expect.stringContaining('Công ty A'),
    );
  });

  it('chat riêng (private) → title lấy từ first_name', async () => {
    const { service } = setup({
      updates: [
        groupUpdate('/link K7M2QX', {
          chatId: 42,
          chatType: 'private',
          chatTitle: undefined,
          firstName: 'Phúc',
        }),
      ],
    });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toMatchObject({
      status: 'linked',
      channel: { externalId: '42', title: 'Phúc' },
    });
  });

  it('chưa có tin nhắn khớp → waiting, không tiêu thụ mã', async () => {
    const { service, prisma } = setup({ updates: [groupUpdate('chào cả nhà')] });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'waiting' });
    expect(prisma.channelLinkToken.updateMany).not.toHaveBeenCalled();
  });

  it('lệnh gọi bot khác (@OtherBot) trong nhóm → bỏ qua', async () => {
    const { service } = setup({ updates: [groupUpdate('/link@OtherBot K7M2QX')] });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'waiting' });
  });

  it('chat là channel → bỏ qua (chỉ nhận group/supergroup/private)', async () => {
    const { service } = setup({
      updates: [groupUpdate('/link@TiraproBot K7M2QX', { chatType: 'channel' })],
    });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'waiting' });
  });
});

describe('poll — hết hạn, lỗi và va chạm', () => {
  it('mã đã hết hạn → expired, KHÔNG gọi Telegram', async () => {
    const { service, telegram } = setup({ token: tokenRow({ expiresAt: past }) });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'expired' });
    expect(telegram.recentUpdates).not.toHaveBeenCalled();
  });

  it('mã đã dùng hoặc không tồn tại → expired', async () => {
    const used = setup({ token: tokenRow({ consumedAt: past }) });
    await expect(used.service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'expired' });
    const none = setup({ token: null });
    await expect(none.service.poll('w1', 'g1', 'ZZZZZZ')).resolves.toEqual({ status: 'expired' });
    expect(none.telegram.recentUpdates).not.toHaveBeenCalled();
  });

  it('mã của integration khác không khớp (truy vấn ràng integrationId + workspaceId)', async () => {
    const { service, prisma } = setup({ token: null });
    await service.poll('w1', 'g1', 'K7M2QX');
    expect(prisma.channelLinkToken.findFirst).toHaveBeenCalledWith({
      where: { token: 'K7M2QX', integrationId: 'g1', workspaceId: 'w1' },
    });
  });

  it('updateMany count 0 (hai request song song) → expired, KHÔNG tạo kênh trùng', async () => {
    const { service, prisma, integrations } = setup({
      updates: [groupUpdate('/link@TiraproBot K7M2QX')],
    });
    prisma.channelLinkToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toEqual({ status: 'expired' });
    expect(integrations.addChannel).not.toHaveBeenCalled();
  });

  it('nhóm đã được liên kết từ trước → trả kênh cũ, không tạo thêm', async () => {
    const { service, prisma, integrations } = setup({
      updates: [groupUpdate('/link@TiraproBot K7M2QX')],
    });
    prisma.integrationChannel.findFirst.mockResolvedValue({
      id: 'cOld',
      externalId: '-100123',
      title: 'Dev team',
    } as never);
    await expect(service.poll('w1', 'g1', 'K7M2QX')).resolves.toMatchObject({
      status: 'linked',
      channel: { id: 'cOld' },
    });
    expect(integrations.addChannel).not.toHaveBeenCalled();
  });

  it('409 từ Telegram → status error + gợi ý webhook', async () => {
    const { service, telegram } = setup();
    telegram.recentUpdates.mockRejectedValue(new TelegramWebhookConflictError());
    const res = await service.poll('w1', 'g1', 'K7M2QX');
    expect(res.status).toBe('error');
    expect((res as { hint: string }).hint).toContain('webhook');
  });

  it('token bị Telegram từ chối → error + đánh dấu như reportUnusableToken', async () => {
    const { service, telegram, integrations } = setup();
    telegram.recentUpdates.mockRejectedValue(new TelegramTokenRejectedError());
    const res = await service.poll('w1', 'g1', 'K7M2QX');
    expect(res.status).toBe('error');
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('token riêng không giải mã được → error + reportUnusableToken, không gọi Telegram', async () => {
    const { service, telegram, integrations } = setup();
    telegram.resolveBotToken.mockReturnValue({ kind: 'unusable' });
    const res = await service.poll('w1', 'g1', 'K7M2QX');
    expect(res.status).toBe('error');
    expect(integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
    expect(telegram.recentUpdates).not.toHaveBeenCalled();
  });

  it('lỗi mạng tạm thời → vẫn waiting (kèm hint), để FE thử lại ở lần sau', async () => {
    const { service, telegram } = setup();
    telegram.recentUpdates.mockRejectedValue(new TelegramUnreachableError());
    const res = await service.poll('w1', 'g1', 'K7M2QX');
    expect(res.status).toBe('waiting');
    expect((res as { hint?: string }).hint).toContain('Telegram');
  });

  it('thêm kênh thất bại bất ngờ → trả mã về chưa dùng để thử lại và ném lỗi', async () => {
    const { service, prisma, integrations } = setup({
      updates: [groupUpdate('/link@TiraproBot K7M2QX')],
    });
    integrations.addChannel.mockRejectedValue(new Error('db down'));
    await expect(service.poll('w1', 'g1', 'K7M2QX')).rejects.toThrow('db down');
    expect(prisma.channelLinkToken.updateMany).toHaveBeenLastCalledWith({
      where: { id: 't1' },
      data: { consumedAt: null },
    });
  });

  it('mã sai định dạng → expired ngay, không truy vấn', async () => {
    const { service, prisma } = setup();
    await expect(service.poll('w1', 'g1', 'abc')).resolves.toEqual({ status: 'expired' });
    expect(prisma.channelLinkToken.findFirst).not.toHaveBeenCalled();
  });
});
