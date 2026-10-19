import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  clearSelection,
  pruneSelection,
  selectRange,
  setMany,
  toggleId,
} from './selection';

const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();
const order = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('toggleId', () => {
  it('chọn rồi bỏ chọn một id, ghi nhớ mốc là id vừa bấm', () => {
    const s1 = toggleId(EMPTY_SELECTION, 'b');
    expect(ids(s1)).toEqual(['b']);
    expect(s1.anchor).toBe('b');
    const s2 = toggleId(s1, 'b');
    expect(ids(s2)).toEqual([]);
  });
  it('không sửa trạng thái đầu vào', () => {
    const s1 = toggleId(EMPTY_SELECTION, 'a');
    toggleId(s1, 'b');
    expect(ids(s1)).toEqual(['a']);
  });
});

describe('selectRange (Shift+click theo thứ tự hiển thị)', () => {
  it('chọn dải từ mốc tới id bấm, cả hai chiều, giữ phần đã chọn', () => {
    const s = toggleId(toggleId(EMPTY_SELECTION, 'f'), 'b'); // đã có f, mốc = b
    expect(ids(selectRange(s, order, 'd'))).toEqual(['b', 'c', 'd', 'f']);
    const up = toggleId(EMPTY_SELECTION, 'e');
    expect(ids(selectRange(up, order, 'b'))).toEqual(['b', 'c', 'd', 'e']);
  });
  it('mốc giữ nguyên để Shift+click tiếp theo mở rộng/thu theo cùng mốc', () => {
    const s = selectRange(toggleId(EMPTY_SELECTION, 'b'), order, 'd');
    expect(s.anchor).toBe('b');
  });
  it('chưa có mốc (hoặc mốc không còn trong thứ tự): chỉ chọn id bấm và đặt nó làm mốc', () => {
    const s = selectRange(EMPTY_SELECTION, order, 'c');
    expect(ids(s)).toEqual(['c']);
    expect(s.anchor).toBe('c');
    const gone = { ids: new Set(['zz']), anchor: 'zz' };
    expect(ids(selectRange(gone, order, 'c'))).toEqual(['c', 'zz']);
  });
  it('id bấm không có trong thứ tự: chỉ bật id đó', () => {
    const s = selectRange(toggleId(EMPTY_SELECTION, 'a'), order, 'nope');
    expect(ids(s)).toEqual(['a', 'nope']);
  });
});

describe('setMany / clear', () => {
  it('thêm hoặc bớt cả nhóm, không đụng phần khác', () => {
    const s = setMany(toggleId(EMPTY_SELECTION, 'a'), ['b', 'c'], true);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(ids(setMany(s, ['a', 'b'], false))).toEqual(['c']);
  });
  it('clear luôn trả CHÍNH EMPTY (bỏ chọn khi đã rỗng không vẽ lại)', () => {
    expect(clearSelection()).toBe(EMPTY_SELECTION);
    expect(EMPTY_SELECTION.ids.size).toBe(0);
  });
});

describe('pruneSelection (dữ liệu làm mới/realtime làm mất việc đang chọn)', () => {
  it('bỏ id không còn tồn tại, mốc cũng bỏ nếu mất', () => {
    const s = selectRange(toggleId(EMPTY_SELECTION, 'a'), order, 'c');
    const p = pruneSelection(s, new Set(['b', 'c', 'd']));
    expect(ids(p)).toEqual(['b', 'c']);
    expect(p.anchor).toBeNull();
  });
  it('không có gì để bỏ → trả CHÍNH trạng thái cũ (tham chiếu ổn định)', () => {
    const s = toggleId(EMPTY_SELECTION, 'a');
    expect(pruneSelection(s, new Set(['a', 'b']))).toBe(s);
  });
});
