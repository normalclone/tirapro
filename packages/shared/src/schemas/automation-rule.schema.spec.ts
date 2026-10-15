import { describe, expect, it } from 'vitest';
import {
  createRuleSchema,
  ruleActionSchema,
  WEBHOOK_SECRET_MAX_LENGTH,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SECRET_STORED_MAX_LENGTH,
} from './automation-rule.schema';

describe('automation rule schema', () => {
  it('nhận action hợp lệ và từ chối thiếu trường theo từng loại', () => {
    expect(ruleActionSchema.safeParse({ type: 'assign', mode: 'lead' }).success).toBe(true);
    expect(ruleActionSchema.safeParse({ type: 'assign', mode: 'user' }).success).toBe(false);
    expect(
      ruleActionSchema.safeParse({ type: 'setField', field: 'storyPoints', value: 'abc' }).success,
    ).toBe(false);
    expect(
      ruleActionSchema.safeParse({ type: 'setField', field: 'priorityId', value: null }).success,
    ).toBe(true);
    expect(ruleActionSchema.safeParse({ type: 'notify', message: 'hi' }).success).toBe(false);
    expect(ruleActionSchema.safeParse({ type: 'webhook', url: 'ftp://x.y' }).success).toBe(false);
    expect(ruleActionSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });

  it('createRule cần ít nhất một action, mặc định conditions rỗng', () => {
    const ok = createRuleSchema.parse({
      name: 'r',
      trigger: 'ISSUE_CREATED',
      actions: [{ type: 'assign', mode: 'reporter' }],
    });
    expect(ok.conditions).toEqual([]);
    expect(
      createRuleSchema.safeParse({ name: 'r', trigger: 'ISSUE_CREATED', actions: [] }).success,
    ).toBe(false);
  });

  it('secret webhook: plaintext ≤ 200 ký tự; dạng đã mã hoá (enc:v1:) được dài tới giới hạn lưu', () => {
    const wh = (secret: string) =>
      ruleActionSchema.safeParse({ type: 'webhook', url: 'https://a.test/h', secret });
    expect(wh('x'.repeat(WEBHOOK_SECRET_MAX_LENGTH)).success).toBe(true);
    expect(wh('x'.repeat(WEBHOOK_SECRET_MAX_LENGTH + 1)).success).toBe(false);
    expect(wh('********').success).toBe(true);
    // 200 đơn vị UTF-16 × 3 byte: iv 12 + tag 16 + ct 600 byte => hex 1256 + 2 dấu ':' + tiền tố
    const sealedWorst = `${WEBHOOK_SECRET_PREFIX}${'a'.repeat(24)}:${'b'.repeat(32)}:${'c'.repeat(1200)}`;
    expect(sealedWorst.length).toBeLessThan(WEBHOOK_SECRET_STORED_MAX_LENGTH);
    expect(wh(sealedWorst).success).toBe(true);
    expect(wh(WEBHOOK_SECRET_PREFIX + 'a'.repeat(WEBHOOK_SECRET_STORED_MAX_LENGTH)).success).toBe(
      false,
    );
  });
});
