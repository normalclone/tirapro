import { describe, expect, it } from 'vitest';
import { applyPendingOrder, byRank, sortByRank } from './rankOrder';

const mk = (...ids: string[]) => ids.map((id) => ({ id, rank: id }));
const ids = (l: Array<{ id: string }>) => l.map((i) => i.id);

describe('byRank / sortByRank', () => {
  it('rank tăng dần, trùng rank thì theo id (khớp ORDER BY rank, id của API)', () => {
    const l = [
      { id: 'b', rank: 'n' },
      { id: 'a', rank: 'n' },
      { id: 'c', rank: 'i' },
    ];
    expect(ids(sortByRank(l))).toEqual(['c', 'a', 'b']);
    expect(l[0]!.id).toBe('b'); // không đổi mảng vào
    expect(byRank(l[0]!, l[0]!)).toBe(0);
  });
});

describe('applyPendingOrder', () => {
  it('đặt ngay sau afterId', () => {
    expect(
      ids(applyPendingOrder(mk('a', 'b', 'c', 'd'), [{ id: 'd', afterId: 'a', beforeId: 'b' }])),
    ).toEqual(['a', 'd', 'b', 'c']);
  });
  it('chỉ có beforeId (lên đầu danh sách)', () => {
    expect(
      ids(applyPendingOrder(mk('a', 'b', 'c'), [{ id: 'c', afterId: null, beforeId: 'a' }])),
    ).toEqual(['c', 'a', 'b']);
  });
  it('chỉ có afterId (xuống cuối)', () => {
    expect(
      ids(applyPendingOrder(mk('a', 'b', 'c'), [{ id: 'a', afterId: 'c', beforeId: null }])),
    ).toEqual(['b', 'c', 'a']);
  });
  it('mốc không còn trong danh sách (đã lọc/bị xoá) => giữ nguyên vị trí; không mốc => giữ nguyên', () => {
    expect(
      ids(applyPendingOrder(mk('a', 'b', 'c'), [{ id: 'c', afterId: 'x', beforeId: 'y' }])),
    ).toEqual(['a', 'b', 'c']);
    expect(
      ids(applyPendingOrder(mk('a', 'b', 'c'), [{ id: 'c', afterId: null, beforeId: null }])),
    ).toEqual(['a', 'b', 'c']);
  });
  it('nhiều mục chờ áp theo thứ tự hàng đợi; mục không có trong danh sách (thuộc container khác) bị bỏ qua', () => {
    const out = applyPendingOrder(mk('a', 'b', 'c', 'd'), [
      { id: 'd', afterId: 'a', beforeId: null },
      { id: 'zzz', afterId: 'a', beforeId: null },
      { id: 'c', afterId: 'a', beforeId: 'd' },
    ]);
    expect(ids(out)).toEqual(['a', 'c', 'd', 'b']);
  });
});
