import { beforeEach, describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import {
  appendResults,
  initialPaging,
  pagingReducer,
  type ResultSet,
} from '@/features/saved-filters/resultPaging';
import {
  applyOverlay,
  clearIssueOverlay,
  recordIssueChange,
  recordIssueDeleted,
  useIssueOverlayStore,
  type OverlayEntry,
} from './issueOverlay';

const row = (id: string, version: number, extra: Partial<IssueDto> = {}) =>
  ({ id, key: id.toUpperCase(), version, summary: `việc ${id}`, ...extra }) as IssueDto;
const entries = (...e: [string, OverlayEntry][]) => new Map(e);

describe('applyOverlay — phủ thay đổi từ menu lên kết quả bộ lọc', () => {
  const items = [row('a', 1), row('b', 1), row('c', 1)];

  it('không có gì để phủ → trả CHÍNH mảng đó (tham chiếu ổn định, memo/trang không bị kích)', () => {
    expect(applyOverlay(items, new Map())).toBe(items);
    // mục không khớp dòng nào
    expect(applyOverlay(items, entries(['zzz', { patch: { version: 9 }, version: 9 }]))).toBe(
      items,
    );
  });
  it('phiên bản MỚI hơn thay dòng (giữ vị trí, không đụng dòng khác)', () => {
    const out = applyOverlay(
      items,
      entries([
        'b',
        { patch: { version: 2, summary: 'đã đổi', status: { id: 's2' } as never }, version: 2 },
      ]),
    );
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(out[1]).toMatchObject({ id: 'b', version: 2, summary: 'đã đổi' });
    expect(out[0]).toBe(items[0]);
    expect(out[2]).toBe(items[2]);
  });
  it('phiên bản CŨ hơn hoặc bằng bị bỏ qua (dòng đã nạp lại mới hơn không bị ghi đè)', () => {
    expect(applyOverlay(items, entries(['a', { patch: { summary: 'cũ' }, version: 1 }]))).toBe(
      items,
    );
    const newer = [row('a', 5)];
    expect(applyOverlay(newer, entries(['a', { patch: { summary: 'cũ' }, version: 3 }]))).toBe(
      newer,
    );
  });
  it('dòng đã xoá bị ẨN (bất kể phiên bản)', () => {
    const out = applyOverlay(items, entries(['b', { deleted: true, version: 0 }]));
    expect(out.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('không sửa mảng/đối tượng đầu vào', () => {
    const snapshot = JSON.stringify(items);
    applyOverlay(
      items,
      entries(['a', { patch: { summary: 'x' }, version: 2 }], ['c', { deleted: true, version: 0 }]),
    );
    expect(JSON.stringify(items)).toBe(snapshot);
  });
  it('null (chưa chạy) → null', () => {
    expect(applyOverlay(null, entries(['a', { deleted: true, version: 0 }]))).toBeNull();
  });
});

describe('trang và phần "Tải thêm" không nhúc nhích khi phủ', () => {
  it('phủ chỉ đổi cái nhìn: kết quả gốc/more giữ nguyên tham chiếu → pagingReducer giữ trang', () => {
    const base: ResultSet = {
      items: Array.from({ length: 60 }, (_, i) => row(`b${i}`, 1)),
      hasMore: true,
      nextCursor: 'c1',
    };
    const more: ResultSet = {
      items: Array.from({ length: 30 }, (_, i) => row(`m${i}`, 1)),
      hasMore: false,
      nextCursor: null,
    };
    const active = { kind: 'adhoc' };
    let paging = pagingReducer(initialPaging(active, base), { type: 'go', page: 3 });
    const shown = appendResults(base, more);
    const overlay = entries(
      ['b50', { patch: { summary: 'đổi ở trang 3', version: 2 }, version: 2 }],
      ['m3', { deleted: true, version: 0 }],
    );
    const view = applyOverlay(shown.items, overlay);
    expect(view).toHaveLength(89);
    expect(view.find((i) => i.id === 'b50')?.summary).toBe('đổi ở trang 3');
    expect(view.some((i) => i.id === 'm3')).toBe(false);
    // gốc và more không bị đụng
    expect(base.items.find((i) => i.id === 'b50')?.summary).toBe('việc b50');
    expect(more.items).toHaveLength(30);
    // không có refetch → `base` cùng tham chiếu → đồng bộ không đưa về trang 1
    paging = pagingReducer(paging, { type: 'sync', active, base });
    expect(paging.page).toBe(3);
  });
});

describe('store phủ', () => {
  beforeEach(() => clearIssueOverlay());
  it('ghi theo id, giữ bản mới nhất, hỗ trợ xoá và dọn', () => {
    recordIssueChange({ id: 'a', version: 2, summary: 'v2' });
    recordIssueChange({ id: 'a', version: 4, summary: 'v4' });
    recordIssueChange({ id: 'a', version: 3, summary: 'v3 đến muộn' }); // cũ hơn: bỏ
    expect(useIssueOverlayStore.getState().entries.get('a')).toMatchObject({ version: 4 });
    expect(useIssueOverlayStore.getState().entries.get('a')?.patch?.summary).toBe('v4');
    recordIssueDeleted('b');
    expect(useIssueOverlayStore.getState().entries.get('b')?.deleted).toBe(true);
    clearIssueOverlay();
    expect(useIssueOverlayStore.getState().entries.size).toBe(0);
  });
  it('mỗi lần ghi tạo Map mới (để selector nhận ra thay đổi)', () => {
    const before = useIssueOverlayStore.getState().entries;
    recordIssueChange({ id: 'a', version: 2 });
    expect(useIssueOverlayStore.getState().entries).not.toBe(before);
  });
  it('phản hồi không có dạng việc (thiếu id/version) → bỏ qua', () => {
    recordIssueChange({} as never);
    recordIssueChange(undefined as never);
    expect(useIssueOverlayStore.getState().entries.size).toBe(0);
  });
});
