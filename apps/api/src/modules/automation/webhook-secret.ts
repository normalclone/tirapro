import { BusinessRuleException } from '../../common/exceptions/app.exception';

/** Tiền tố phân biệt tuyệt đối "đã mã hoá" với dữ liệu cũ lưu plaintext (secret thuần có thể chứa dấu ':'). */
export const WEBHOOK_SECRET_PREFIX = 'enc:v1:';
/** Giá trị API trả thay khoá bí mật; client gửi lại nguyên giá trị này = "giữ khoá cũ". */
export const WEBHOOK_SECRET_MASK = '********';

export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(enc: string): string | null;
}

type Action = Record<string, unknown>;
const isWebhook = (a: unknown): a is Action & { secret?: string } =>
  !!a && typeof a === 'object' && (a as Action).type === 'webhook';

const withoutSecret = (a: Action): Action =>
  Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'secret'));

/** Giải mã secret đã lưu. Không tiền tố = dữ liệu cũ (plaintext) → trả nguyên; không giải mã được → null. */
export const openSecret = (c: SecretCipher, stored: string): string | null =>
  stored.startsWith(WEBHOOK_SECRET_PREFIX)
    ? c.decrypt(stored.slice(WEBHOOK_SECRET_PREFIX.length))
    : stored;

/**
 * Mã hoá secret webhook trước khi lưu. `previous` = actions hiện có của quy tắc (để giữ khoá theo VỊ TRÍ khi
 * client gửi lại mask). Mọi secret khác mask (kể cả chuỗi bắt đầu bằng `enc:v1:`) đều là plaintext và bị mã hoá.
 */
export function sealWebhookActions(
  c: SecretCipher,
  actions: unknown[],
  previous: unknown[] | undefined,
): unknown[] {
  return actions.map((a, i) => {
    if (!isWebhook(a)) return a;
    if (a.secret === undefined || a.secret === '') return withoutSecret(a);
    if (a.secret === WEBHOOK_SECRET_MASK) {
      const old = previous?.[i];
      if (isWebhook(old) && typeof old.secret === 'string' && old.secret)
        return { ...a, secret: old.secret };
      throw new BusinessRuleException(
        'Khoá bí mật của webhook đã thay đổi — hãy nhập lại khoá bí mật',
      );
    }
    return { ...a, secret: WEBHOOK_SECRET_PREFIX + c.encrypt(a.secret) };
  });
}

export const maskWebhookActions = (actions: unknown[]): unknown[] =>
  actions.map((a) => (isWebhook(a) && a.secret ? { ...a, secret: WEBHOOK_SECRET_MASK } : a));
