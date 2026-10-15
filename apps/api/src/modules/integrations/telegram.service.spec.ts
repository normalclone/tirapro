import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { TelegramError } from 'telegraf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramService, TelegramUnreachableError } from './telegram.service';

// Telegraf giả: getMe điều khiển được; TelegramError giữ nguyên bản thật.
const tg = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock('telegraf', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('telegraf');
  class FakeTelegraf {
    telegram = { getMe: tg.getMe };
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
