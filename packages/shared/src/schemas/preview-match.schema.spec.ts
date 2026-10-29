import { describe, expect, it } from 'vitest';
import {
  containsUnstorableText,
  createRuleSchema,
  previewMatchSchema,
  ruleConditionSchema,
} from './automation-rule.schema';

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
  it('ký tự NUL (\\u0000) ở bất kỳ đâu trong điều kiện bị từ chối (Postgres không lưu/so được → sẽ là lỗi 500)', () => {
    const bad: unknown[] = [
      { field: 'summary', op: 'contains', value: 'a\u0000b' },
      { field: 'summary', op: 'in', value: ['ok', 'a\u0000'] },
      { field: 'summary', op: 'eq', value: { a: ['x\u0000'] } },
      { field: 'summary', op: 'eq', value: { 'k\u0000': 1 } },
      { jql: 'text ~ "a\u0000b"' },
    ];
    for (const c of bad) {
      expect(ruleConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
      expect(previewMatchSchema.safeParse({ conditions: [c] }).success).toBe(false);
    }
    // Cùng schema cho tạo quy tắc: NUL trong điều kiện không được lưu vào jsonb.
    expect(
      createRuleSchema.safeParse({
        name: 'r',
        trigger: 'ISSUE_CREATED',
        conditions: [bad[0]],
        actions: [{ type: 'assign' }],
      }).success,
    ).toBe(false);
  });
  it('chuỗi UTF-16 hỏng (surrogate lẻ) cũng bị từ chối — Prisma không tuần tự hoá được', () => {
    expect(
      ruleConditionSchema.safeParse({ field: 'summary', op: 'contains', value: 'a\ud800' }).success,
    ).toBe(false);
    expect(ruleConditionSchema.safeParse({ jql: 'text ~ "\udc00"' }).success).toBe(false);
  });
  it('chữ thường, tiếng Việt, emoji, ký tự đặc biệt vẫn hợp lệ', () => {
    for (const v of ['lỗi', 'Đ', '😀', '%_\\', '', 'a\tb\n'])
      expect(
        ruleConditionSchema.safeParse({ field: 'summary', op: 'contains', value: v }).success,
        v,
      ).toBe(true);
  });
  it('containsUnstorableText: sâu trong mảng/đối tượng, cả khoá; NUL và surrogate lẻ', () => {
    expect(containsUnstorableText('a\u0000')).toBe(true);
    expect(containsUnstorableText(['a', { b: ['c\u0000'] }])).toBe(true);
    expect(containsUnstorableText({ ['\u0000']: 1 })).toBe(true);
    expect(containsUnstorableText('x\ud83d')).toBe(true); // nửa trên của cặp thay thế
    expect(containsUnstorableText('\ude00x')).toBe(true); // nửa dưới lẻ
    expect(containsUnstorableText('😀 ok')).toBe(false); // cặp đủ
    expect(containsUnstorableText({ a: 1, b: [null, true, 'x'] })).toBe(false);
    expect(containsUnstorableText(undefined)).toBe(false);
  });
});
