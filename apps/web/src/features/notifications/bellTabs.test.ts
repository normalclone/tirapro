import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorDisplay,
  BELL_TABS,
  bellEmptyText,
  notificationsHref,
  bellTabKey,
  parseBellTab,
  readBellTab,
  writeBellTab,
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

describe('tab nhớ theo người dùng', () => {
  function stubStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    return store;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('khoá chứa id người dùng', () => {
    expect(bellTabKey('u1')).toBe('tirapro:bellTab:v1:u1');
    expect(bellTabKey('u1')).not.toBe(bellTabKey('u2'));
  });
  it('hai người dùng chung trình duyệt không lẫn tab', () => {
    stubStorage();
    writeBellTab('u1', 'mentioned');
    writeBellTab('u2', 'assigned');
    expect(readBellTab('u1')).toBe('mentioned');
    expect(readBellTab('u2')).toBe('assigned');
    expect(readBellTab('u3')).toBe('all');
  });
  it('chưa biết người dùng → all và không ghi', () => {
    const store = stubStorage();
    writeBellTab(undefined, 'assigned');
    expect(store.size).toBe(0);
    expect(readBellTab(undefined)).toBe('all');
  });
  it('localStorage ném lỗi → all, không ném', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(readBellTab('u1')).toBe('all');
    expect(() => writeBellTab('u1', 'mentioned')).not.toThrow();
  });
});
