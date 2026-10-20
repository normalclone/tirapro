import { describe, expect, it } from 'vitest';
import { toggleRoleIds } from './roleSet';

describe('toggleRoleIds', () => {
  it('thêm vai trò chưa chọn vào cuối', () => {
    expect(toggleRoleIds(['a'], 'b', { requireOne: true })).toEqual(['a', 'b']);
  });
  it('bỏ vai trò đang chọn', () => {
    expect(toggleRoleIds(['a', 'b'], 'a', { requireOne: true })).toEqual(['b']);
  });
  it('requireOne: không bỏ vai trò cuối cùng (trả nguyên giá trị)', () => {
    const v = ['a'];
    expect(toggleRoleIds(v, 'a', { requireOne: true })).toBe(v);
  });
  it('không requireOne: bỏ được vai trò cuối', () => {
    expect(toggleRoleIds(['a'], 'a', { requireOne: false })).toEqual([]);
  });
  it('vai trò bị khoá không bỏ chọn được, nhưng khoá không chặn việc thêm', () => {
    const v = ['a', 'b'];
    expect(toggleRoleIds(v, 'a', { requireOne: true, locked: { a: 'lý do' } })).toBe(v);
    expect(toggleRoleIds(['a'], 'c', { requireOne: true, locked: { a: 'lý do' } })).toEqual([
      'a',
      'c',
    ]);
  });
  it('không đổi mảng đầu vào', () => {
    const v = ['a'];
    toggleRoleIds(v, 'b', { requireOne: true });
    expect(v).toEqual(['a']);
  });
});
