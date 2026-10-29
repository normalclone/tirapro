import { WEBHOOK_SECRET_MAX_LENGTH, WEBHOOK_SECRET_PREFIX } from '@tirapro/shared';
import { BusinessRuleException } from '../../common/exceptions/app.exception';

/** Tiền tố `enc:v1:` phân biệt tuyệt đối "đã mã hoá" với dữ liệu cũ lưu plaintext (secret thuần có thể chứa dấu ':'). */
export { WEBHOOK_SECRET_MAX_LENGTH };
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

/**
 * Giải mã secret đã lưu. Không tiền tố = dữ liệu cũ (plaintext) → trả nguyên. Có tiền tố thì phần sau BẮT BUỘC
 * đúng dạng `iv:tag:ct` (TelegramService.decrypt trả nguyên chuỗi khi không đủ 3 phần — không được dùng làm khoá HMAC);
 * sai dạng hoặc không giải mã được → null.
 */
export function openSecret(c: SecretCipher, stored: string): string | null {
  if (!stored.startsWith(WEBHOOK_SECRET_PREFIX)) return stored;
  const body = stored.slice(WEBHOOK_SECRET_PREFIX.length);
  if (body.split(':').length !== 3) return null;
  return c.decrypt(body);
}

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
    if (a.secret.length > WEBHOOK_SECRET_MAX_LENGTH)
      throw new BusinessRuleException(`Khoá bí mật tối đa ${WEBHOOK_SECRET_MAX_LENGTH} ký tự`);
    return { ...a, secret: WEBHOOK_SECRET_PREFIX + c.encrypt(a.secret) };
  });
}

export const maskWebhookActions = (actions: unknown[]): unknown[] =>
  actions.map((a) => (isWebhook(a) && a.secret ? { ...a, secret: WEBHOOK_SECRET_MASK } : a));
