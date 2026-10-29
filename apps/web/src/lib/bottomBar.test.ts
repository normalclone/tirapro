import { describe, expect, it } from 'vitest';
import { BOTTOM_BAR_PX, notificationsTabLabel, unreadBadgeText } from './bottomBar';

describe('thanh tab đáy', () => {
  it('cao 56px', () => expect(BOTTOM_BAR_PX).toBe(56));
  it('huy hiệu chưa đọc: số thật tới 99, từ 100 là "99+"', () => {
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
    expect(unreadBadgeText(4210)).toBe('99+');
  });
  it('tên truy cập ô Thông báo kèm số chưa đọc (không cắt)', () => {
    expect(notificationsTabLabel(0)).toBe('Thông báo');
    expect(notificationsTabLabel(4)).toBe('Thông báo, 4 chưa đọc');
    expect(notificationsTabLabel(150)).toBe('Thông báo, 150 chưa đọc');
  });
});
