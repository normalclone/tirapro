import { describe, expect, it } from 'vitest';
import {
  maskWebhookActions,
  openSecret,
  sealWebhookActions,
  WEBHOOK_SECRET_MASK,
} from './webhook-secret';

const cipher = {
  encrypt: (p: string) => `E[${p}]`,
  decrypt: (e: string) => (e.startsWith('E[') ? e.slice(2, -1) : null),
};

describe('webhook-secret', () => {
  it('seal mã hoá secret mới, không đụng action khác', () => {
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a', secret: 'k1' }, { type: 'notify' }],
      undefined,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[k1]');
    expect(out[1]).toEqual({ type: 'notify' });
  });

  it('secret là mask => lấy lại giá trị đã lưu cùng chỉ số; sai vị trí => 422', () => {
    const prev = [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[old]' }];
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a', secret: WEBHOOK_SECRET_MASK }],
      prev,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[old]');
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
      [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[evil]' }],
      undefined,
    ) as Array<Record<string, unknown>>;
    expect(out[0]!.secret).toBe('enc:v1:E[enc:v1:E[evil]]');
  });

  it('bỏ trống secret => xoá khoá', () => {
    const out = sealWebhookActions(
      cipher,
      [{ type: 'webhook', url: 'https://a' }],
      [{ type: 'webhook', url: 'https://a', secret: 'enc:v1:E[old]' }],
    ) as Array<Record<string, unknown>>;
    expect('secret' in out[0]!).toBe(false);
  });

  it('mask thay mọi secret bằng ******** ; open: mã hoá → giải mã, plaintext cũ → trả nguyên, hỏng → null', () => {
    expect(
      (
        maskWebhookActions([
          { type: 'webhook', url: 'u', secret: 'enc:v1:E[k]' },
          { type: 'webhook', url: 'u' },
        ]) as Array<Record<string, unknown>>
      ).map((a) => a.secret),
    ).toEqual([WEBHOOK_SECRET_MASK, undefined]);
    expect(openSecret(cipher, 'enc:v1:E[k]')).toBe('k');
    expect(openSecret(cipher, 'legacy:plain')).toBe('legacy:plain');
    expect(openSecret(cipher, 'enc:v1:zzz')).toBeNull();
  });
});
