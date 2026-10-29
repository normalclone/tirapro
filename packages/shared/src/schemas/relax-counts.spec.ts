import { describe, expect, it } from 'vitest';
import { relaxCountsSchema } from './common';

describe('relaxCountsSchema', () => {
  it('nhận jql (+ projectId tuỳ chọn)', () => {
    expect(relaxCountsSchema.parse({ jql: 'status = Done' })).toEqual({ jql: 'status = Done' });
    expect(relaxCountsSchema.parse({ jql: 'status = Done', projectId: 'p1' })).toEqual({
      jql: 'status = Done',
      projectId: 'p1',
    });
  });
  it('thiếu jql / rỗng / toàn khoảng trắng → lỗi', () => {
    expect(relaxCountsSchema.safeParse({}).success).toBe(false);
    expect(relaxCountsSchema.safeParse({ jql: '' }).success).toBe(false);
    expect(relaxCountsSchema.safeParse({ jql: '   ' }).success).toBe(false);
  });
  it('quá 5.000 ký tự → "JQL quá dài" (cùng giới hạn /search/validate)', () => {
    const r = relaxCountsSchema.safeParse({ jql: 'a'.repeat(5_001) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('JQL quá dài');
    expect(relaxCountsSchema.safeParse({ jql: 'a'.repeat(5_000) }).success).toBe(true);
  });
  it('projectId rỗng không được', () => {
    expect(relaxCountsSchema.safeParse({ jql: 'x = 1', projectId: '' }).success).toBe(false);
  });
});
