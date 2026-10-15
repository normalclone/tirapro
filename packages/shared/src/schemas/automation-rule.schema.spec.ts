import { describe, expect, it } from 'vitest';
import { createRuleSchema, ruleActionSchema } from './automation-rule.schema';

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
});
