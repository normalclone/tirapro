import { describe, expect, it } from 'vitest';
import { previewMatchSchema } from './automation-rule.schema';

describe('previewMatchSchema', () => {
  it('nhận điều kiện trường và JQL, projectId tuỳ chọn', () => {
    const r = previewMatchSchema.parse({
      projectId: 'p1',
      conditions: [{ field: 'statusId', op: 'eq', value: 's1' }, { jql: 'priority = High' }],
    });
    expect(r.projectId).toBe('p1');
    expect(r.conditions).toHaveLength(2);
    expect(previewMatchSchema.parse({ conditions: [] })).toEqual({ conditions: [] });
  });
  it('thiếu conditions → lỗi; tối đa 20 điều kiện', () => {
    expect(previewMatchSchema.safeParse({}).success).toBe(false);
    const c = { field: 'statusId', op: 'empty' };
    expect(previewMatchSchema.safeParse({ conditions: Array(20).fill(c) }).success).toBe(true);
    expect(previewMatchSchema.safeParse({ conditions: Array(21).fill(c) }).success).toBe(false);
  });
  it('dùng đúng ruleConditionSchema: trường/phép lạ và JQL rỗng bị từ chối', () => {
    expect(
      previewMatchSchema.safeParse({ conditions: [{ field: 'nope', op: 'eq' }] }).success,
    ).toBe(false);
    expect(
      previewMatchSchema.safeParse({ conditions: [{ field: 'statusId', op: 'zzz' }] }).success,
    ).toBe(false);
    expect(previewMatchSchema.safeParse({ conditions: [{ jql: '  ' }] }).success).toBe(false);
  });
  it('projectId rỗng không được', () => {
    expect(previewMatchSchema.safeParse({ projectId: '', conditions: [] }).success).toBe(false);
  });
});
