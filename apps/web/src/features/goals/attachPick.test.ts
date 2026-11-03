import { describe, expect, it } from 'vitest';
import { pickState, toggleAllPicked } from './attachPick';

describe('Gắn công việc vào mục tiêu — chọn tất cả (logbug #28)', () => {
  it('trạng thái none/some/all', () => {
    expect(pickState([], ['a', 'b'])).toBe('none');
    expect(pickState(['a'], ['a', 'b'])).toBe('some');
    expect(pickState(['a', 'b'], ['a', 'b'])).toBe('all');
    expect(pickState(['a'], [])).toBe('none');
  });
  it('chọn tất cả rồi bỏ tất cả, giữ việc đã chọn ở ngoài danh sách hiện', () => {
    const all = toggleAllPicked(['x'], ['a', 'b']);
    expect(all).toEqual(['x', 'a', 'b']);
    expect(toggleAllPicked(all, ['a', 'b'])).toEqual(['x']);
    expect(toggleAllPicked(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
