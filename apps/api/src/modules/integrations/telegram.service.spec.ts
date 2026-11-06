import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { TelegramError } from 'telegraf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TelegramService,
  TelegramTokenRejectedError,
  TelegramUnreachableError,
  TelegramWebhookConflictError,
  isStopCommand,
  parseLinkCommand,
  parseStartCommand,
} from './telegram.service';

// Telegraf giả: getMe điều khiển được; TelegramError giữ nguyên bản thật.
const tg = vi.hoisted(() => ({ getMe: vi.fn(), getUpdates: vi.fn(), sendMessage: vi.fn() }));
vi.mock('telegraf', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('telegraf');
  class FakeTelegraf {
    telegram = { getMe: tg.getMe, getUpdates: tg.getUpdates, sendMessage: tg.sendMessage };
  }
  return { ...actual, Telegraf: FakeTelegraf };
});

const NEW_KEY = 'k_new_'.padEnd(40, 'n');
const OLD_KEY = 'k_old_'.padEnd(40, 'o');

function make(current: string, previous = '') {
  const config = {
    get: vi.fn((k: string) => {
      if (k === 'integrations.encryptionKey') return current;
      if (k === 'integrations.encryptionKeyPrevious') return previous;
      return undefined;
    }),
  };
  return new TelegramService(
    config as never,
    { flags: () => ({ integrationsEnabled: true }) } as never,
  );
}

/** Mã hoá y hệt TelegramService.encrypt nhưng bằng khoá tuỳ ý (mô phỏng dữ liệu cũ). */
function encryptWith(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

describe('TelegramService.decrypt', () => {
  it('khứ hồi với khoá hiện tại', () => {
    const svc = make(NEW_KEY);
    expect(svc.decrypt(svc.encrypt('123:ABC'))).toBe('123:ABC');
  });

  it('token mã hoá bằng khoá cũ → giải được nhờ INTEGRATION_ENCRYPTION_KEY_PREVIOUS', () => {
    const svc = make(NEW_KEY, OLD_KEY);
    expect(svc.decrypt(encryptWith(OLD_KEY, '123:ABC'))).toBe('123:ABC');
  });

  it('encrypt luôn dùng khoá hiện tại (khoá mới giải được, khoá cũ thì không)', () => {
    const enc = make(NEW_KEY, OLD_KEY).encrypt('123:ABC');
    expect(make(NEW_KEY).decrypt(enc)).toBe('123:ABC');
    expect(make(OLD_KEY).decrypt(enc)).toBeNull();
  });

  it('không khoá nào giải được → null (KHÔNG trả ciphertext) và log lỗi', () => {
    const svc = make(NEW_KEY);
    const logSpy = vi
      .spyOn((svc as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    const enc = encryptWith(OLD_KEY, '123:ABC');
    expect(svc.decrypt(enc)).toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('ciphertext hỏng (không phải hex hợp lệ) → null', () => {
    expect(make(NEW_KEY).decrypt('zz:yy:xx')).toBeNull();
  });

  it('dữ liệu cũ dạng plaintext (không có dạng iv:tag:data) → trả nguyên', () => {
    expect(make(NEW_KEY).decrypt('123456:ABC-def')).toBe('123456:ABC-def');
  });
});

describe('TelegramService.resolveBotToken', () => {
  it.each([[{}], [null], [{ botToken: null, useGlobal: true }], [{ botToken: '' }], [[]]])(
    'không có botToken riêng (%j) → global',
    (cfg) => {
      expect(make(NEW_KEY).resolveBotToken(cfg as never)).toEqual({ kind: 'global' });
    },
  );

  it.each([[{ botToken: 123 }], [{ botToken: {} }], [{ botToken: true }], [{ botToken: [] }]])(
    'botToken có mặt nhưng không phải string (%j) → unusable, KHÔNG rơi về global',
    (cfg) => {
      expect(make(NEW_KEY).resolveBotToken(cfg as never)).toEqual({ kind: 'unusable' });
    },
  );

  it('botToken giải mã được → own, trả token đã giải', () => {
    const svc = make(NEW_KEY);
    expect(svc.resolveBotToken({ botToken: svc.encrypt('123:ABC') })).toEqual({
      kind: 'own',
      token: '123:ABC',
    });
  });

  it('botToken mã hoá bằng khoá không còn → unusable (KHÔNG rơi về global)', () => {
    const svc = make(NEW_KEY);
    vi.spyOn(
      (svc as unknown as { logger: { error: () => void } }).logger,
      'error',
    ).mockImplementation(() => undefined);
    expect(svc.resolveBotToken({ botToken: encryptWith(OLD_KEY, '123:ABC') })).toEqual({
      kind: 'unusable',
    });
    expect(svc.resolveBotToken({ botToken: 'zz:yy:xx' })).toEqual({ kind: 'unusable' });
  });
});

describe('TelegramService.getMe', () => {
  afterEach(() => {
    tg.getMe.mockReset();
    vi.useRealTimers();
  });
  const silence = (svc: TelegramService) =>
    vi
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

  it('token đúng → trả id/username/firstName', async () => {
    tg.getMe.mockResolvedValue({ id: 7, username: 'tira_bot', first_name: 'Tira', is_bot: true });
    await expect(make(NEW_KEY).getMe('1:A')).resolves.toEqual({
      id: 7,
      username: 'tira_bot',
      firstName: 'Tira',
    });
  });

  it.each([401, 404])('Telegram trả %i → token sai → null', async (code) => {
    tg.getMe.mockRejectedValue(new TelegramError({ error_code: code, description: 'x' }));
    await expect(make(NEW_KEY).getMe('1:A')).resolves.toBeNull();
  });

  it('lỗi mạng ≠ token sai → ném TelegramUnreachableError, không log token', async () => {
    tg.getMe.mockRejectedValue(new Error('ECONNRESET'));
    const svc = make(NEW_KEY);
    const warn = silence(svc);
    await expect(svc.getMe('999:SECRET')).rejects.toBeInstanceOf(TelegramUnreachableError);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('Telegram 5xx → coi là không liên lạc được (không kết luận token sai)', async () => {
    tg.getMe.mockRejectedValue(new TelegramError({ error_code: 502, description: 'bad gateway' }));
    const svc = make(NEW_KEY);
    silence(svc);
    await expect(svc.getMe('1:A')).rejects.toBeInstanceOf(TelegramUnreachableError);
  });

  it('quá 8 giây không phản hồi → TelegramUnreachableError', async () => {
    vi.useFakeTimers();
    tg.getMe.mockReturnValue(new Promise(() => undefined));
    const p = make(NEW_KEY).getMe('1:A');
    const assertion = expect(p).rejects.toBeInstanceOf(TelegramUnreachableError);
    await vi.advanceTimersByTimeAsync(8001);
    await assertion;
  });
});

describe('TelegramService.globalBotUsername', () => {
  afterEach(() => tg.getMe.mockReset());

  function makeWithGlobal() {
    const config = {
      get: vi.fn((k: string) => {
        if (k === 'integrations.telegram') return { globalBotToken: '5:GLOBAL' };
        if (k === 'integrations.encryptionKey') return NEW_KEY;
        return undefined;
      }),
    };
    return new TelegramService(
      config as never,
      { flags: () => ({ integrationsEnabled: true }) } as never,
    );
  }

  it('không có bot chung → null, không gọi Telegram', async () => {
    await expect(make(NEW_KEY).globalBotUsername()).resolves.toBeNull();
    expect(tg.getMe).not.toHaveBeenCalled();
  });

  it('có bot chung → trả username và cache (gọi getMe một lần)', async () => {
    tg.getMe.mockResolvedValue({ id: 1, username: 'global_bot', first_name: 'G' });
    const svc = makeWithGlobal();
    await expect(svc.globalBotUsername()).resolves.toBe('global_bot');
    await expect(svc.globalBotUsername()).resolves.toBe('global_bot');
    expect(tg.getMe).toHaveBeenCalledTimes(1);
  });

  it('lấy thất bại → null và không thử lại dồn dập', async () => {
    tg.getMe.mockRejectedValue(new Error('down'));
    const svc = makeWithGlobal();
    vi.spyOn(
      (svc as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
    await expect(svc.globalBotUsername()).resolves.toBeNull();
    await expect(svc.globalBotUsername()).resolves.toBeNull();
    expect(tg.getMe).toHaveBeenCalledTimes(1);
  });
});

describe('parseLinkCommand', () => {
  it('/link@Bot K7M2QX và /link k7m2qx đều ra K7M2QX; lệnh khác → null', () => {
    expect(parseLinkCommand('/link@TiraproBot K7M2QX')).toBe('K7M2QX');
    expect(parseLinkCommand('/link k7m2qx')).toBe('K7M2QX');
    expect(parseLinkCommand('/start')).toBeNull();
    expect(parseLinkCommand('hello /link K7M2QX')).toBeNull();
  });
  it('mã sai độ dài/ký tự → null; có chữ thừa phía sau thì không khớp', () => {
    expect(parseLinkCommand('/link K7M2Q')).toBeNull();
    expect(parseLinkCommand('/link K7M2QXZ')).toBeNull();
    expect(parseLinkCommand('/link K7M2QX cảm ơn')).toBe('K7M2QX');
  });
  it('có botUsername: lệnh gọi bot khác → null, đúng bot (không phân biệt hoa thường) → mã', () => {
    expect(parseLinkCommand('/link@OtherBot K7M2QX', 'TiraproBot')).toBeNull();
    expect(parseLinkCommand('/link@tiraprobot K7M2QX', 'TiraproBot')).toBe('K7M2QX');
    expect(parseLinkCommand('/link K7M2QX', 'TiraproBot')).toBe('K7M2QX');
  });
});

describe('TelegramService.recentUpdates', () => {
  afterEach(() => tg.getUpdates.mockReset());

  it('gọi getUpdates với offset -100, limit 100, timeout 0 và trả các bản tin văn bản', async () => {
    tg.getUpdates.mockResolvedValue([
      {
        update_id: 1,
        message: {
          text: '/link@B K7M2QX',
          date: 5,
          chat: { id: -100, type: 'supergroup', title: 'Dev' },
        },
      },
      { update_id: 2, edited_message: { text: 'x' } },
      { update_id: 3, message: { date: 6, chat: { id: 9, type: 'private' }, sticker: {} } },
    ]);
    const res = await make(NEW_KEY).recentUpdates('1:A');
    expect(tg.getUpdates).toHaveBeenCalledWith(0, 100, -100, ['message']);
    expect(res).toEqual([
      {
        chatId: -100,
        chatType: 'supergroup',
        chatTitle: 'Dev',
        firstName: undefined,
        text: '/link@B K7M2QX',
        date: 5,
      },
    ]);
  });

  it('hai lần đọc cùng token chạy NỐI TIẾP (không chồng nhau); khác token thì song song; lỗi lần trước không chặn lần sau', async () => {
    const svc = make(NEW_KEY);
    vi.spyOn(
      (svc as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
    let inFlight = 0;
    let maxInFlight = 0;
    const calls: string[] = [];
    tg.getUpdates.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push('start');
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (calls.length === 1) throw new Error('ECONNRESET');
      return [];
    });
    const [a, b, c] = await Promise.allSettled([
      svc.recentUpdates('1:A'),
      svc.recentUpdates('1:A'),
      svc.recentUpdates('1:A'),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('fulfilled');
    expect(c.status).toBe('fulfilled');
    expect(maxInFlight).toBe(1);
    // token khác → không phải chờ
    inFlight = 0;
    maxInFlight = 0;
    await Promise.all([svc.recentUpdates('1:A'), svc.recentUpdates('2:B')]);
    expect(maxInFlight).toBe(2);
  });

  it('409 → TelegramWebhookConflictError; 401 → TelegramTokenRejectedError; khác → Unreachable', async () => {
    const svc = make(NEW_KEY);
    vi.spyOn(
      (svc as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);
    tg.getUpdates.mockRejectedValueOnce(new TelegramError({ error_code: 409, description: 'x' }));
    await expect(svc.recentUpdates('1:A')).rejects.toBeInstanceOf(TelegramWebhookConflictError);
    tg.getUpdates.mockRejectedValueOnce(new TelegramError({ error_code: 401, description: 'x' }));
    await expect(svc.recentUpdates('1:A')).rejects.toBeInstanceOf(TelegramTokenRejectedError);
    tg.getUpdates.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(svc.recentUpdates('1:A')).rejects.toBeInstanceOf(TelegramUnreachableError);
  });
});

describe('parseStartCommand / isStopCommand', () => {
  it('/start MÃ (deep link) → mã chuẩn hoá chữ hoa; /start trơn → code null; lệnh khác → null', () => {
    expect(parseStartCommand('/start k7m2qx9abc')).toEqual({ code: 'K7M2QX9ABC' });
    expect(parseStartCommand('/start@TiraBot K7M2QX9ABC', 'tirabot')).toEqual({
      code: 'K7M2QX9ABC',
    });
    expect(parseStartCommand('/start')).toEqual({ code: null });
    expect(parseStartCommand('/link K7M2QX')).toBeNull();
    expect(parseStartCommand('xin chào /start')).toBeNull();
    expect(parseStartCommand('/start a b')).toBeNull();
  });
  it('lệnh gọi bot khác → bỏ qua', () => {
    expect(parseStartCommand('/start@KhacBot K7M2QX9ABC', 'TiraBot')).toBeNull();
    expect(isStopCommand('/stop@KhacBot', 'TiraBot')).toBe(false);
  });
  it('/stop và /stop@Bot → true; /stopx hoặc có chữ thừa → false', () => {
    expect(isStopCommand('/stop')).toBe(true);
    expect(isStopCommand(' /stop@TiraBot ', 'TiraBot')).toBe(true);
    expect(isStopCommand('/stopx')).toBe(false);
    expect(isStopCommand('/stop now')).toBe(false);
  });
});

describe('TelegramService.sendDetailed', () => {
  afterEach(() => tg.sendMessage.mockReset());
  const quiet = (svc: TelegramService) =>
    vi
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

  it('gửi được → ok (và send() trả true)', async () => {
    tg.sendMessage.mockResolvedValue({});
    const svc = make(NEW_KEY);
    expect(await svc.sendDetailed('1:A', '9', 'hi')).toBe('ok');
    expect(await svc.send('1:A', '9', 'hi')).toBe(true);
  });
  it('403 (bot bị chặn) và 400 chat not found → blocked; send() vẫn trả false', async () => {
    const svc = make(NEW_KEY);
    quiet(svc);
    tg.sendMessage.mockRejectedValueOnce(
      new TelegramError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }),
    );
    expect(await svc.sendDetailed('1:A', '9', 'hi')).toBe('blocked');
    tg.sendMessage.mockRejectedValueOnce(
      new TelegramError({ error_code: 400, description: 'Bad Request: chat not found' }),
    );
    expect(await svc.sendDetailed('1:A', '9', 'hi')).toBe('blocked');
    tg.sendMessage.mockRejectedValueOnce(
      new TelegramError({ error_code: 403, description: 'Forbidden' }),
    );
    expect(await svc.send('1:A', '9', 'hi')).toBe(false);
  });
  it('lỗi khác (429/mạng) → failed, không ném', async () => {
    const svc = make(NEW_KEY);
    quiet(svc);
    tg.sendMessage.mockRejectedValueOnce(
      new TelegramError({ error_code: 429, description: 'Too Many Requests' }),
    );
    expect(await svc.sendDetailed('1:A', '9', 'hi')).toBe('failed');
    tg.sendMessage.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await svc.sendDetailed('1:A', '9', 'hi')).toBe('failed');
  });
  it('thiếu token (không bot chung) → disabled', async () => {
    expect(await make(NEW_KEY).sendDetailed(null, '9', 'hi')).toBe('disabled');
  });
});
