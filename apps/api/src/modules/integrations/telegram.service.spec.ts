import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TelegramService } from './telegram.service';

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
