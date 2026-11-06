import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IntegrationsService } from './integrations.service';
import { TelegramPersonalService } from './telegram-personal.service';
import {
  TelegramService,
  TelegramTokenRejectedError,
  TelegramUnreachableError,
  TelegramWebhookConflictError,
} from './telegram.service';

describe('TelegramPersonalService — Nest DI', () => {
  it('dựng được qua Nest DI', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        TelegramPersonalService,
        { provide: PrismaService, useValue: {} },
        { provide: TelegramService, useValue: {} },
        { provide: IntegrationsService, useValue: {} },
      ],
    }).compile();
    expect(mod.get(TelegramPersonalService)).toBeInstanceOf(TelegramPersonalService);
  });
});

const NOW = new Date('2026-11-06T10:00:00.000Z');
const nowSec = Math.floor(NOW.getTime() / 1000);
const CODE = 'K7M2QX9ABC';

const integration = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  organizationId: 'w1',
  type: 'TELEGRAM',
  name: 'n',
  config: { botToken: 'ENC', useGlobal: false, botUsername: 'TiraproBot' },
  status: 'ACTIVE',
  ...over,
});

const codeRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: CODE,
  userId: 'u1',
  organizationId: 'w1',
  integrationId: 'g1',
  expiresAt: new Date(NOW.getTime() + 5 * 60_000),
  consumedAt: null,
  ...over,
});

const priv = (text: string, over: Record<string, unknown> = {}) => ({
  chatId: 555,
  chatType: 'private',
  firstName: 'Linh',
  username: 'linh_nt',
  text,
  date: nowSec - 5,
  ...over,
});

function setup(
  opts: {
    integrations?: unknown[];
    code?: unknown;
    updates?: unknown[];
    link?: unknown;
    platformEnabled?: boolean;
    resolve?: { kind: string; token?: string };
  } = {},
) {
  const prisma = {
    integration: {
      findMany: vi.fn(() => Promise.resolve(opts.integrations ?? [integration()])),
      findFirst: vi.fn(() => Promise.resolve(integration())),
    },
    organization: { findUnique: vi.fn(() => Promise.resolve({ name: 'TECA' })) },
    userTelegramLinkCode: {
      findFirst: vi.fn(() => Promise.resolve(opts.code === undefined ? codeRow() : opts.code)),
      create: vi.fn((a: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'c1', ...a.data }),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    userTelegramLink: {
      findUnique: vi.fn(() => Promise.resolve(opts.link ?? null)),
      findFirst: vi.fn(() => Promise.resolve(opts.link ?? null)),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      upsert: vi.fn(() => Promise.resolve({})),
    },
  };
  const telegram = {
    platformEnabled: vi.fn(() => opts.platformEnabled ?? true),
    resolveBotToken: vi.fn(() => opts.resolve ?? { kind: 'own', token: 'T' }),
    available: vi.fn(() => true),
    globalBotUsername: vi.fn(() => Promise.resolve('global_bot')),
    recentUpdates: vi.fn(() => Promise.resolve(opts.updates ?? [])),
    send: vi.fn(() => Promise.resolve(true)),
  };
  const integrations = { reportUnusableToken: vi.fn(() => Promise.resolve()) };
  const service = new TelegramPersonalService(
    prisma as never,
    telegram as never,
    integrations as never,
  );
  service.clock = () => NOW;
  return { service, prisma, telegram, integrations };
}

describe('resolveBot / status', () => {
  it('chọn kết nối ACTIVE cũ nhất có bot dùng được; bỏ qua kết nối token hỏng', async () => {
    const { service, telegram } = setup({
      integrations: [integration({ id: 'bad' }), integration({ id: 'ok' })],
    });
    telegram.resolveBotToken
      .mockReturnValueOnce({ kind: 'unusable' })
      .mockReturnValue({ kind: 'own', token: 'T' });
    const r = await service.resolveBot('w1');
    expect('bot' in r && r.bot.integration.id).toBe('ok');
  });

  it('không có kết nối ACTIVE → NO_BOT; kill-switch hệ thống → PLATFORM_OFF', async () => {
    expect(await setup({ integrations: [] }).service.resolveBot('w1')).toEqual({
      reason: 'NO_BOT',
    });
    expect(await setup({ platformEnabled: false }).service.resolveBot('w1')).toEqual({
      reason: 'PLATFORM_OFF',
    });
  });

  it('bot chung mà hệ thống không có token → NO_BOT; bot chung có token → username lấy từ getMe của bot chung', async () => {
    const none = setup({
      integrations: [integration({ config: { useGlobal: true } })],
      resolve: { kind: 'global' },
    });
    none.telegram.available.mockReturnValue(false);
    expect(await none.service.resolveBot('w1')).toEqual({ reason: 'NO_BOT' });
    const ok = setup({
      integrations: [integration({ config: { useGlobal: true } })],
      resolve: { kind: 'global' },
    });
    const r = await ok.service.resolveBot('w1');
    expect('bot' in r && r.bot.botUsername).toBe('global_bot');
  });

  it('status: không lộ chatId; chưa liên kết → linked null', async () => {
    const linked = setup({
      link: { username: 'linh_nt', linkedAt: new Date('2026-11-01T00:00:00Z'), chatId: '555' },
    });
    const st = await linked.service.status('u1', 'w1');
    expect(st).toEqual({
      available: true,
      reason: null,
      botUsername: 'TiraproBot',
      linked: { username: 'linh_nt', linkedAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(JSON.stringify(st)).not.toContain('555');
    expect((await setup().service.status('u1', 'w1')).linked).toBeNull();
  });

  it('status khi đã liên kết: quét /stop NỀN (không chặn phản hồi), giới hạn một lần mỗi 15 giây cho mỗi bot', async () => {
    const link = { id: 'l1', username: 'x', linkedAt: new Date(NOW.getTime() - 10_000) };
    const { service, prisma, telegram } = setup({
      link,
      updates: [priv('/stop', { date: nowSec - 2 })],
    });
    const st = await service.status('u1', 'w1');
    expect(st.linked).not.toBeNull(); // trả theo dữ liệu đọc lúc đầu
    await new Promise((r) => setTimeout(r, 0));
    expect(prisma.userTelegramLink.deleteMany).toHaveBeenCalledWith({ where: { id: 'l1' } });
    await service.status('u1', 'w1');
    expect(telegram.recentUpdates).toHaveBeenCalledTimes(1);
  });

  it('status chưa liên kết thì KHÔNG gọi Telegram', async () => {
    const { service, telegram } = setup();
    await service.status('u1', 'w1');
    await new Promise((r) => setTimeout(r, 0));
    expect(telegram.recentUpdates).not.toHaveBeenCalled();
  });

  it('status khi tổ chức chưa có bot: available=false, lý do, vẫn trả liên kết cũ (nếu có)', async () => {
    const st = await setup({ integrations: [] }).service.status('u1', 'w1');
    expect(st).toMatchObject({ available: false, reason: 'NO_BOT', linked: null });
  });
});

describe('createCode', () => {
  it('mã 10 ký tự bảng không nhập nhằng, hạn 10 phút, deep link ?start=<mã>', async () => {
    const { service, prisma } = setup();
    const r = await service.createCode('u1', 'w1');
    expect(r!.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    expect(r!.expiresAt).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString());
    expect(r!.deepLink).toBe(`https://t.me/TiraproBot?start=${r!.code}`);
    expect(r!.command).toBe(`/start ${r!.code}`);
    expect(prisma.userTelegramLinkCode.create.mock.calls[0]![0].data).toMatchObject({
      userId: 'u1',
      organizationId: 'w1',
      integrationId: 'g1',
    });
  });

  it('vô hiệu mã cũ CỦA CHÍNH NGƯỜI NÀY trước khi tạo mã mới (không đụng mã người khác)', async () => {
    const { service, prisma } = setup();
    await service.createCode('u1', 'w1');
    expect(prisma.userTelegramLinkCode.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', organizationId: 'w1', consumedAt: null, expiresAt: { gt: NOW } },
      data: { expiresAt: NOW },
    });
  });

  it('tổ chức chưa có bot → null, không tạo mã', async () => {
    const { service, prisma } = setup({ integrations: [] });
    expect(await service.createCode('u1', 'w1')).toBeNull();
    expect(prisma.userTelegramLinkCode.create).not.toHaveBeenCalled();
  });

  it('chưa biết @username bot → deepLink null nhưng vẫn có lệnh /start', async () => {
    const { service } = setup({ integrations: [integration({ config: { botToken: 'ENC' } })] });
    const r = await service.createCode('u1', 'w1');
    expect(r!.deepLink).toBeNull();
    expect(r!.command).toMatch(/^\/start [A-Z0-9]{10}$/);
  });
});

describe('poll', () => {
  it('/start <mã> từ chat riêng → tiêu thụ mã (CAS), lưu liên kết với chatId+username, bot xác nhận, trả linked', async () => {
    const { service, prisma, telegram } = setup({ updates: [priv(`/start ${CODE}`)] });
    const res = await service.poll('u1', 'w1', CODE.toLowerCase());
    expect(res).toEqual({ status: 'linked', username: 'linh_nt' });
    expect(prisma.userTelegramLinkCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', consumedAt: null, expiresAt: { gt: NOW } },
      data: { consumedAt: NOW },
    });
    expect(prisma.userTelegramLink.deleteMany).toHaveBeenCalledWith({
      where: { integrationId: 'g1', chatId: '555', NOT: { userId: 'u1' } },
    });
    expect(prisma.userTelegramLink.upsert).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'u1', organizationId: 'w1' } },
      create: {
        userId: 'u1',
        organizationId: 'w1',
        integrationId: 'g1',
        chatId: '555',
        username: 'linh_nt',
      },
      update: { integrationId: 'g1', chatId: '555', username: 'linh_nt', linkedAt: NOW },
    });
    expect(telegram.send).toHaveBeenCalledWith(
      'T',
      '555',
      expect.stringContaining('Đã liên kết với Tirapro (TECA)'),
    );
  });

  it('/start@TenBot <mã> cũng được; tin trong NHÓM thì không tính (chỉ chat riêng)', async () => {
    const a = setup({ updates: [priv(`/start@TiraproBot ${CODE}`)] });
    expect((await a.service.poll('u1', 'w1', CODE)).status).toBe('linked');
    const b = setup({ updates: [priv(`/start ${CODE}`, { chatType: 'supergroup' })] });
    expect(await b.service.poll('u1', 'w1', CODE)).toEqual({ status: 'waiting' });
    expect(b.prisma.userTelegramLink.upsert).not.toHaveBeenCalled();
  });

  it('username trống (người dùng chưa đặt) → linked username null', async () => {
    const { service } = setup({ updates: [priv(`/start ${CODE}`, { username: undefined })] });
    expect(await service.poll('u1', 'w1', CODE)).toEqual({ status: 'linked', username: null });
  });

  it('mã sai dạng / không phải của người này / hết hạn / đã dùng → expired, không đọc Telegram', async () => {
    const mk = (code: unknown) => setup({ code, updates: [priv(`/start ${CODE}`)] });
    for (const s of [
      mk(null),
      mk(codeRow({ expiresAt: new Date(NOW.getTime() - 1) })),
      mk(codeRow({ consumedAt: NOW })),
    ]) {
      expect(await s.service.poll('u1', 'w1', CODE)).toEqual({ status: 'expired' });
      expect(s.telegram.recentUpdates).not.toHaveBeenCalled();
    }
    const bad = setup();
    expect(await bad.service.poll('u1', 'w1', 'abc')).toEqual({ status: 'expired' });
    // tra theo (mã, người dùng, tổ chức): người khác không poll được mã của bạn
    await bad.service.poll('u9', 'w1', CODE);
    expect(bad.prisma.userTelegramLinkCode.findFirst).toHaveBeenCalledWith({
      where: { code: CODE, userId: 'u9', organizationId: 'w1' },
    });
  });

  it('chưa có tin khớp → waiting; hai request song song (CAS count 0) → expired, không tạo liên kết', async () => {
    const w = setup({ updates: [] });
    expect(await w.service.poll('u1', 'w1', CODE)).toEqual({ status: 'waiting' });
    const race = setup({ updates: [priv(`/start ${CODE}`)] });
    race.prisma.userTelegramLinkCode.updateMany.mockResolvedValue({ count: 0 });
    expect(await race.service.poll('u1', 'w1', CODE)).toEqual({ status: 'expired' });
    expect(race.prisma.userTelegramLink.upsert).not.toHaveBeenCalled();
  });

  it('lưu liên kết lỗi → trả mã về chưa dùng rồi ném lại (không "đốt" mã)', async () => {
    const { service, prisma } = setup({ updates: [priv(`/start ${CODE}`)] });
    prisma.userTelegramLink.upsert.mockRejectedValue(new Error('db'));
    await expect(service.poll('u1', 'w1', CODE)).rejects.toThrow('db');
    expect(prisma.userTelegramLinkCode.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'c1' },
      data: { consumedAt: null },
    });
  });

  it('lỗi đọc Telegram: mạng → waiting; webhook 409 / token bị từ chối → error (token bị từ chối đánh dấu kết nối lỗi)', async () => {
    const net = setup();
    net.telegram.recentUpdates.mockRejectedValue(new TelegramUnreachableError());
    expect((await net.service.poll('u1', 'w1', CODE)).status).toBe('waiting');
    const conflict = setup();
    conflict.telegram.recentUpdates.mockRejectedValue(new TelegramWebhookConflictError());
    expect((await conflict.service.poll('u1', 'w1', CODE)).status).toBe('error');
    const rejected = setup();
    rejected.telegram.recentUpdates.mockRejectedValue(new TelegramTokenRejectedError());
    expect((await rejected.service.poll('u1', 'w1', CODE)).status).toBe('error');
    expect(rejected.integrations.reportUnusableToken).toHaveBeenCalledWith('g1');
  });

  it('kết nối bot không còn ACTIVE → error có gợi ý', async () => {
    const { service, prisma } = setup();
    prisma.integration.findFirst.mockResolvedValue(null as never);
    const res = await service.poll('u1', 'w1', CODE);
    expect(res.status).toBe('error');
  });

  it('/start với mã SAI/hết hạn trong chat riêng → bot báo rõ MỘT lần (đọc lại cùng tin không trả lời lại)', async () => {
    const { service, telegram, prisma } = setup({ updates: [priv('/start ZZZZZZZZZZ')] });
    prisma.userTelegramLinkCode.findFirst
      .mockResolvedValueOnce(codeRow()) // mã đang poll
      .mockResolvedValue(null); // mã trong tin: không tồn tại
    expect(await service.poll('u1', 'w1', CODE)).toEqual({ status: 'waiting' });
    expect(telegram.send).toHaveBeenCalledTimes(1);
    expect(telegram.send).toHaveBeenCalledWith(
      'T',
      '555',
      expect.stringContaining('Mã không đúng'),
    );
    await service.poll('u1', 'w1', CODE);
    expect(telegram.send).toHaveBeenCalledTimes(1);
  });

  it('/start mang mã đang chờ của NGƯỜI KHÁC → để yên (poll của họ sẽ xử lý); /start trơn → hướng dẫn', async () => {
    const other = setup({ updates: [priv('/start AAAAAAAAAA')] });
    other.prisma.userTelegramLinkCode.findFirst
      .mockResolvedValueOnce(codeRow())
      .mockResolvedValue(codeRow({ code: 'AAAAAAAAAA', userId: 'u2' }));
    await other.service.poll('u1', 'w1', CODE);
    expect(other.telegram.send).not.toHaveBeenCalled();
    const bare = setup({ updates: [priv('/start')] });
    await bare.service.poll('u1', 'w1', CODE);
    expect(bare.telegram.send).toHaveBeenCalledWith(
      'T',
      '555',
      expect.stringContaining('Liên kết Telegram'),
    );
  });

  it('tin /start quá cũ (>15 phút) không được trả lời', async () => {
    const { service, telegram } = setup({
      updates: [priv('/start ZZZZZZZZZZ', { date: nowSec - 3600 })],
    });
    await service.poll('u1', 'w1', CODE);
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it('/stop từ chat đã liên kết (gõ sau lúc liên kết) → xoá liên kết + bot báo; /stop cũ hơn lúc liên kết thì bỏ qua', async () => {
    const stale = setup({
      updates: [priv('/stop', { date: nowSec - 100 })],
      link: { id: 'l1', linkedAt: new Date(NOW.getTime() - 10_000) },
    });
    await stale.service.poll('u1', 'w1', CODE);
    expect(stale.prisma.userTelegramLink.deleteMany).not.toHaveBeenCalled();
    const fresh = setup({
      updates: [priv('/stop', { date: nowSec - 2 })],
      link: { id: 'l1', linkedAt: new Date(NOW.getTime() - 10_000) },
    });
    await fresh.service.poll('u1', 'w1', CODE);
    expect(fresh.prisma.userTelegramLink.deleteMany).toHaveBeenCalledWith({ where: { id: 'l1' } });
    expect(fresh.telegram.send).toHaveBeenCalledWith(
      'T',
      '555',
      expect.stringContaining('huỷ liên kết'),
    );
  });
});

describe('unlink', () => {
  it('xoá liên kết của chính người gọi trong tổ chức hiện tại', async () => {
    const { service, prisma } = setup();
    expect(await service.unlink('u1', 'w1')).toEqual({ success: true });
    expect(prisma.userTelegramLink.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', organizationId: 'w1' },
    });
  });
});
