import { describe, expect, it } from 'vitest';
import {
  actorDisplay,
  BELL_TABS,
  bellEmptyText,
  notificationsHref,
  parseBellTab,
} from './bellTabs';
import type { NotificationItem } from './api';

describe('BELL_TABS', () => {
  it('đúng 3 tab theo thứ tự và nhãn, id là bộ lọc API hợp lệ', () => {
    expect(BELL_TABS.map((t) => [t.id, t.label])).toEqual([
      ['all', 'Tất cả'],
      ['mentioned', 'Nhắc đến'],
      ['assigned', 'Được giao'],
    ]);
  });
  it('mỗi tab có chữ rỗng riêng', () => {
    expect(new Set(BELL_TABS.map((t) => bellEmptyText(t.id))).size).toBe(3);
    expect(bellEmptyText('mentioned')).toBe('Chưa có ai nhắc đến bạn');
    expect(bellEmptyText('assigned')).toMatch(/giao/);
  });
});

describe('parseBellTab (tab nhớ từ localStorage)', () => {
  it('giá trị hợp lệ giữ nguyên; lạ/null/"unread" → all', () => {
    expect(parseBellTab('mentioned')).toBe('mentioned');
    expect(parseBellTab('assigned')).toBe('assigned');
    expect(parseBellTab('all')).toBe('all');
    for (const bad of [null, undefined, '', 'unread', 'x', '{"a":1}']) {
      expect(parseBellTab(bad as string | null)).toBe('all');
    }
  });
});

describe('notificationsHref', () => {
  it('"Xem tất cả" giữ ngữ cảnh tab đang chọn', () => {
    expect(notificationsHref('all')).toBe('/notifications?tab=all');
    expect(notificationsHref('mentioned')).toBe('/notifications?tab=mentioned');
    expect(notificationsHref('assigned')).toBe('/notifications?tab=assigned');
  });
});

describe('actorDisplay — avatar chỉ khi biết người làm (có tên)', () => {
  const item = (o: Partial<NotificationItem>) =>
    ({ actorId: 'a1', payload: { actorName: 'Dũng' }, ...o }) as NotificationItem;
  it('có actorId + tên → tên và ảnh (hoặc null khi chưa có ảnh/API cũ)', () => {
    expect(actorDisplay(item({ actorAvatarUrl: '/f/a.png' }))).toEqual({
      name: 'Dũng',
      avatarUrl: '/f/a.png',
    });
    expect(actorDisplay(item({}))).toEqual({ name: 'Dũng', avatarUrl: null });
    expect(actorDisplay(item({ actorAvatarUrl: null }))).toEqual({ name: 'Dũng', avatarUrl: null });
  });
  it('không có người làm (hệ thống/sprint) hoặc thiếu tên (người đã xoá) → null: dùng ô icon như cũ', () => {
    expect(actorDisplay(item({ actorId: null }))).toBeNull();
    expect(actorDisplay(item({ payload: {} }))).toBeNull();
  });
});
