import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ruleActionSchema } from '@tirapro/shared';
import { TelegramService } from '../integrations/telegram.service';
import {
  maskWebhookActions,
  openSecret,
  sealWebhookActions,
  WEBHOOK_SECRET_MASK,
  WEBHOOK_SECRET_MAX_LENGTH,
} from './webhook-secret';

const cipher = {
  // Giả dạng ba phần iv:tag:ct như TelegramService thật (openSecret kiểm đúng 3 phần).
  encrypt: (p: string) => `i:t:${p}`,
  decrypt: (e: string) => (e.startsWith('i:t:') ? e.slice(4) : null),
};

describe('webhook-secret', () => {
  it('seal mã hoá secret mới, không đụng action khác', () => {
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a', secret: 'k1' }, { type: 'notify' }],
      undefined,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:i:t:k1');
    expect(out[1]).toEqual({ type: 'notify' });
  });

  it('secret là mask => lấy lại giá trị đã lưu cùng chỉ số; sai vị trí => 422', () => {
    const prev = [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:i:t:old' }];
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a', secret: WEBHOOK_SECRET_MASK }],
      prev,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:i:t:old');
    expect(() =>
      sealWebhookActions(
        cipher,
        [{ type: 'notify' }, { type: 'webhook', url: 'https://a', secret: WEBHOOK_SECRET_MASK }],
        prev,
      ),
    ).toThrowError(expect.objectContaining({ code: 'BUSINESS_RULE_VIOLATION' }) as never);
  });

  it('client gửi sẵn "enc:v1:…" vẫn bị coi là plaintext và mã hoá lại', () => {
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:i:t:evil' }],
      undefined,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:i:t:enc:v1:i:t:evil');
  });

  it('bỏ trống secret => xoá khoá', () => {
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a' }],
      [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:i:t:old' }],
    ) as Array<Record<string, unknown>>;
    expect('secret' in out[0]!).toBe(false);
  });

  it('mask thay mọi secret bằng ******** ; open: mã hoá → giải mã, plaintext cũ → trả nguyên, hỏng → null', () => {
    expect(
      (
        maskWebhookActions([
          { type: 'webhook', url: 'u', secret: 'enc:v1:i:t:k' },
          { type: 'webhook', url: 'u' },
        ]) as Array<Record<string, unknown>>
      ).map((a) => a.secret),
    ).toEqual([WEBHOOK_SECRET_MASK, undefined]);
    expect(openSecret(cipher, 'enc:v1:i:t:k')).toBe('k');
    expect(openSecret(cipher, 'legacy:plain')).toBe('legacy:plain');
    expect(openSecret(cipher, 'enc:v1:zzz')).toBeNull();
  });

  it('openSecret: sau tiền tố bắt buộc đúng 3 phần iv:tag:ct, sai => null (không dùng chuỗi hỏng làm khoá)', () => {
    const real = new TelegramService(
      { get: (k: string) => (k === 'integrations.encryptionKey' ? KEY : undefined) } as never,
      {} as never,
    );
    expect(openSecret(real, 'enc:v1:khong-co-dau-hai-cham')).toBeNull();
    expect(openSecret(real, 'enc:v1:a:b')).toBeNull();
    expect(openSecret(real, 'enc:v1:a:b:c:d')).toBeNull();
    expect(openSecret(real, 'enc:v1:')).toBeNull();
    expect(openSecret(real, 'enc:v1:aa:bb:cc')).toBeNull(); // đủ 3 phần nhưng không giải được
  });

  it('plaintext vượt giới hạn bị từ chối khi seal (kể cả chuỗi trông như enc:v1:…); mask không bị tính', () => {
    const long = 'a'.repeat(WEBHOOK_SECRET_MAX_LENGTH + 1);
    expect(() =>
      sealWebhookActions(cipher, [{ type: 'webhook', url: 'https://a', secret: long }], undefined),
    ).toThrowError(expect.objectContaining({ code: 'BUSINESS_RULE_VIOLATION' }) as never);
    expect(() =>
      sealWebhookActions(
        cipher,
        [{ type: 'webhook', url: 'https://a', secret: `enc:v1:${long}` }],
        undefined,
      ),
    ).toThrowError(expect.objectContaining({ code: 'BUSINESS_RULE_VIOLATION' }) as never);
  });
});

const KEY = 'k'.repeat(40);

describe('webhook-secret với crypto thật (TelegramService) + schema mà engine dùng', () => {
  const real = new TelegramService(
    { get: (k: string) => (k === 'integrations.encryptionKey' ? KEY : undefined) } as never,
    {} as never,
  );
  const actionsSchema = z.array(ruleActionSchema); // cùng schema rule-engine.service.ts dùng khi chạy quy tắc

  it.each([
    ['200 ký tự ASCII', 'x'.repeat(200)],
    ['200 ký tự nhiều byte (BMP 3 byte)', 'ế'.repeat(200)],
    ['200 đơn vị UTF-16 gồm cặp thay thế (emoji 4 byte)', '😀'.repeat(100)],
    ['chứa dấu hai chấm và tiền tố giả', 'enc:v1:a:b:' + 'y'.repeat(100)],
  ])('secret %s: seal -> qua schema dạng lưu -> openSecret trả đúng plaintext', (_n, plain) => {
    expect(plain.length).toBeLessThanOrEqual(WEBHOOK_SECRET_MAX_LENGTH);
    const sealed = sealWebhookActions(
      real,
      [{ type: 'webhook', url: 'https://a.test/h', secret: plain }],
      undefined,
    );
    const stored = (sealed[0] as { secret: string }).secret;
    expect(stored.startsWith('enc:v1:')).toBe(true);
    const parsed = actionsSchema.safeParse(sealed);
    expect(parsed.success).toBe(true);
    expect(openSecret(real, stored)).toBe(plain);
  });
});
