import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { keys } from '@/lib/queryKeys';
import { NotificationRow } from './NotificationRow';
import type { NotificationItem } from './api';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

const item = (o: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  type: 'MENTIONED',
  issueId: 'i1',
  commentId: null,
  actorId: 'a1',
  payload: { actorName: 'Dũng', key: 'D-1', summary: 'Sửa lỗi' },
  readAt: null,
  createdAt: '2026-10-19T00:00:00Z',
  ...o,
});
const html = (i: NotificationItem, dense = true) =>
  renderToStaticMarkup(<NotificationRow item={i} dense={dense} onActivate={() => undefined} />);

describe('<NotificationRow> — avatar người làm', () => {
  it('có ảnh: <img alt=""> trang trí; tên người làm chỉ nằm ở tiêu đề (không lặp trong nhãn truy cập)', () => {
    const h = html(item({ actorAvatarUrl: '/f/a.png' }));
    expect(h).toMatch(/<img[^>]*src="\/f\/a\.png"[^>]*alt=""/);
    expect(h.match(/Dũng/g)).toHaveLength(1); // chỉ trong câu tiêu đề
    expect(h).not.toMatch(/title="Dũng"/);
    expect(h).not.toMatch(/aria-label="[^"]*Dũng/);
  });
  it('không có ảnh (API cũ chưa trả trường): chữ cái đầu, vẫn không lặp tên', () => {
    const h = html(item());
    expect(h).toMatch(/>D</);
    expect(h).not.toMatch(/<img/);
    expect(h.match(/Dũng/g)).toHaveLength(1);
  });
  it('luôn giữ icon loại hành động', () => {
    expect(html(item({ actorAvatarUrl: '/f/a.png' }))).toMatch(/<svg/);
  });
  it('không có người làm → ô icon như cũ, không avatar', () => {
    const h = html(
      item({
        actorId: null,
        type: 'SPRINT_STARTED',
        payload: { sprintName: 'S1' } as never,
        readAt: '2026-10-19T01:00:00Z', // đã đọc: không có chấm tròn chưa đọc
      }),
    );
    expect(h).not.toMatch(/rounded-full/);
    expect(h).toMatch(/<svg/);
  });
});

describe('key cache của popover', () => {
  it('popover(filter) nằm DƯỚI popoverRoot, KHÔNG dưới pageRoot (pageRoot được vá như infinite query)', () => {
    const k = keys.notifications.popover('mentioned');
    expect(k.slice(0, keys.notifications.popoverRoot.length)).toEqual([
      ...keys.notifications.popoverRoot,
    ]);
    expect(k.slice(0, keys.notifications.pageRoot.length)).not.toEqual([
      ...keys.notifications.pageRoot,
    ]);
    expect(k).toContain('mentioned');
  });
  it('realtime notification:new làm mới popoverRoot (tab đang mở cập nhật)', () => {
    expect(read('lib/realtime.ts')).toMatch(/keys\.notifications\.popoverRoot/);
  });
  it('mark-read/mark-all vá và làm mới cả popoverRoot', () => {
    const api = read('features/notifications/api.ts');
    expect(api.match(/keys\.notifications\.popoverRoot/g)!.length).toBeGreaterThanOrEqual(6);
    expect(api).toMatch(/async function fetchNotificationsPopover/);
    expect(api).toMatch(/limit=20|limit: 20/);
  });
});

describe('NotificationBell (nguồn)', () => {
  const src = read('features/notifications/NotificationBell.tsx');
  it('dùng Tabs/TabPanel của phần A (không tự viết bàn phím tab)', () => {
    expect(src).toMatch(/from '@\/components\/ui\/Tabs'/);
    expect(src).toMatch(/<Tabs\b/);
    expect(src).toMatch(/<TabPanel\b/);
    expect(src).not.toMatch(/onKeyDown/);
  });
  it('chỉ tab đang mở truy vấn, và chỉ khi popover mở', () => {
    expect(src.match(/useNotificationsPopover\(/g)).toHaveLength(1);
    expect(src).toMatch(/useNotificationsPopover\(tab, open\)/);
  });
  it('mỗi tab có trạng thái rỗng EmptyState có icon; không huy hiệu theo tab', () => {
    expect(src).toMatch(/<EmptyState/);
    expect(src).toMatch(/bellEmptyText\(tab\)/);
    expect(src).not.toMatch(/unread.*per tab|tabUnread/);
  });
  it('"Xem tất cả" theo tab; đánh dấu đã đọc tất cả giữ hành vi', () => {
    expect(src).toMatch(/notificationsHref\(tab\)/);
    expect(src).toMatch(/markAllRead\.mutate\(\)/);
  });
  it('popover không tràn màn hình hẹp', () => {
    expect(src).toMatch(/max-w-\[calc\(100vw-/);
  });
  it('danh sách giới hạn chiều cao theo viewport, không cố định 24rem', () => {
    expect(src).toMatch(/max-h-\[calc\(100dvh-14rem\)\]/);
    expect(src).not.toMatch(/max-h-96/);
  });
  it('tab nhớ theo id người dùng từ useAuth', () => {
    expect(src).toMatch(/useAuth\(\(s\) => s\.user\?\.id\)/);
    expect(src).toMatch(/readBellTab\(userId\)/);
    expect(src).toMatch(/writeBellTab\(userId, next\)/);
  });
  it('DESIGN.md ghi in ấn dùng giá trị sáng của --warning-fill', () => {
    const design = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'DESIGN.md'), 'utf8');
    expect(design).toMatch(/--warning-fill[^\n]*in ấn|in ấn[^\n]*--warning-fill/);
  });
  it('tab nhớ bằng localStorage bọc try/catch', () => {
    const t = read('features/notifications/bellTabs.ts');
    expect(t).toMatch(/try \{/);
    expect(t).toMatch(/localStorage/);
  });
});
