import { describe, expect, it } from 'vitest';
import { paceTarget } from './goalPace';

describe('paceTarget — vạch kỳ vọng chỉ cho mục tiêu đang chạy', () => {
  it('ACTIVE + có kỳ vọng → số đó', () => {
    expect(paceTarget('ACTIVE', 52)).toBe(52);
    expect(paceTarget('ACTIVE', 0)).toBe(0);
  });
  it('DRAFT / CLOSED → không vạch (không "đáng ra" với thứ chưa/không còn chạy)', () => {
    expect(paceTarget('DRAFT', 52)).toBeUndefined();
    expect(paceTarget('CLOSED', 52)).toBeUndefined();
  });
  it('kỳ tự do (null) / API cũ chưa có trường (undefined) → không vạch', () => {
    expect(paceTarget('ACTIVE', null)).toBeUndefined();
    expect(paceTarget('ACTIVE', undefined)).toBeUndefined();
  });
});
