import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import { markAllReadInPages, markReadInPages } from './pages';
import type { NotificationItem } from './api';

const n = (id: string, readAt: string | null) => ({ id, readAt }) as unknown as NotificationItem;
const data = (): InfiniteData<{ data: NotificationItem[] }> => ({
  pages: [{ data: [n('a', null), n('b', '2026-10-01T00:00:00Z')] }, { data: [n('c', null)] }],
  pageParams: [undefined, 'b'],
});

describe('pages cache helpers', () => {
  it('markReadInPages chỉ đổi đúng dòng chưa đọc, giữ cấu trúc trang', () => {
    const out = markReadInPages(data(), 'c', '2026-10-15T00:00:00Z')!;
    expect(out.pages[1]!.data[0]!.readAt).toBe('2026-10-15T00:00:00Z');
    expect(out.pages[0]!.data[0]!.readAt).toBeNull();
    expect(out.pageParams).toEqual([undefined, 'b']);
  });
  it('dòng đã đọc không bị ghi đè thời điểm', () => {
    expect(markReadInPages(data(), 'b', 'X')!.pages[0]!.data[1]!.readAt).toBe(
      '2026-10-01T00:00:00Z',
    );
  });
  it('markAllReadInPages đánh dấu mọi dòng chưa đọc; undefined giữ nguyên', () => {
    const out = markAllReadInPages(data(), 'T')!;
    expect(out.pages.flatMap((p) => p.data).every((i) => i.readAt)).toBe(true);
    expect(markAllReadInPages(undefined, 'T')).toBeUndefined();
    expect(markReadInPages(undefined, 'a', 'T')).toBeUndefined();
  });
  it('dòng đã đọc giữ nguyên thời điểm cũ khi đánh dấu tất cả', () => {
    expect(markAllReadInPages(data(), 'T')!.pages[0]!.data[1]!.readAt).toBe('2026-10-01T00:00:00Z');
  });
});
