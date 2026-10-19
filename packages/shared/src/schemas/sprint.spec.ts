import { describe, expect, it } from 'vitest';
import { startSprintSchema } from './sprint';

describe('startSprintSchema', () => {
  it('body rỗng / thiếu = hợp lệ (tương thích client cũ)', () => {
    expect(startSprintSchema.safeParse({}).success).toBe(true);
    expect(startSprintSchema.parse(undefined)).toEqual({});
  });

  it('nhận ngày ISO + mục tiêu, cho phép null để xoá', () => {
    const r = startSprintSchema.safeParse({
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: '2026-10-29T00:00:00.000Z',
      goal: 'Ra mắt bản beta',
    });
    expect(r.success).toBe(true);
    expect(startSprintSchema.safeParse({ endDate: null, goal: null }).success).toBe(true);
  });

  it('từ chối ngày sai định dạng', () => {
    expect(startSprintSchema.safeParse({ endDate: '29/10/2026' }).success).toBe(false);
    expect(startSprintSchema.safeParse({ startDate: '2026-10-15' }).success).toBe(false);
  });

  it('mục tiêu tối đa 1000 ký tự', () => {
    expect(startSprintSchema.safeParse({ goal: 'a'.repeat(1000) }).success).toBe(true);
    expect(startSprintSchema.safeParse({ goal: 'a'.repeat(1001) }).success).toBe(false);
  });
});
