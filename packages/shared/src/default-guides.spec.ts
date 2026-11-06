import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDES } from './default-guides';
import type { TourContent } from './guides';

const tours = DEFAULT_GUIDES.filter((g) => g.type === 'TOUR');

const MAIN_SCREENS = ['/', '/members', '/p/:key/backlog', '/p/:key/board', '/settings/roles'];
/** Các màn bổ sung (đợt "hướng dẫn cho màn còn thiếu"): mỗi màn một tour. */
const MORE_SCREENS = [
  // Cá nhân & chung
  '/me',
  '/projects',
  '/notifications',
  '/account',
  '/account/teams',
  '/filters',
  '/wiki',
  '/issue/:key',
  '/dashboards/:id',
  // Trong một dự án
  '/p/:key/triage',
  '/p/:key/trash',
  '/p/:key/activity',
  '/p/:key/reports',
  '/p/:key/gantt',
  '/p/:key/tree',
  '/p/:key/goals',
  '/p/:key/risks',
  '/p/:key/config',
  // Cài đặt tổ chức, Kết nối
  '/settings/general',
  '/settings/audit',
  '/settings/notifications',
  '/settings/severities',
  '/settings/priorities',
  '/settings/fields',
  '/settings/workflows',
  '/settings/import',
  '/settings/api',
  '/connect/integrations',
  '/connect/automation',
  // Quản trị hệ thống
  '/admin/organizations',
  '/admin/accounts',
  '/admin/config',
  '/admin/system',
  '/admin/points',
];
describe('DEFAULT_GUIDES', () => {
  it('khoá duy nhất; mỗi màn có tối đa một tour; đủ 5 màn chính cộng các màn bổ sung', () => {
    expect(new Set(DEFAULT_GUIDES.map((g) => g.key)).size).toBe(DEFAULT_GUIDES.length);
    const screens = tours.map((t) => t.screen);
    expect(new Set(screens).size).toBe(screens.length);
    expect([...screens].sort()).toEqual([...MAIN_SCREENS, ...MORE_SCREENS].sort());
  });
  it('mẫu screen khớp cách `routeToScreen` của web chuẩn hoá: chỉ :key (mã) / :id, màn dự án bắt đầu /p/:key/', () => {
    for (const t of tours) {
      expect(t.screen).toMatch(/^\/[a-z0-9:/-]*$/);
      expect(t.screen).not.toMatch(/.\/$|^\/(?:p|issue|dashboards)\/(?!:)/); // không chứa id cụ thể, không có / cuối
      if (t.screen.startsWith('/p/')) expect(t.screen).toMatch(/^\/p\/:key\/[a-z]+$/);
    }
  });
  it.each(tours)(
    '$key: 2–5 bước (màn có tab loại trừ nhau chỉ cần 2), thứ tự 0..n-1 liên tục, selector dạng data-tour',
    (t) => {
      const steps = (t.content as TourContent).steps;
      expect(steps.length).toBeGreaterThanOrEqual(t.key === 'tour-integrations' ? 2 : 3);
      expect(steps.length).toBeLessThanOrEqual(5);
      expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i));
      for (const s of steps)
        if (s.selector) expect(s.selector).toMatch(/^\[data-tour="[a-z0-9-]+"\]$/);
    },
  );
  it.each(tours)('$key: bước 0 có selector; nội dung ngắn gọn, đúng thuật ngữ', (t) => {
    const steps = (t.content as TourContent).steps;
    expect(steps[0]!.selector).toBeTruthy();
    for (const s of steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeLessThanOrEqual(230);
      expect(['top', 'bottom', 'left', 'right', 'over', 'auto']).toContain(s.placement);
    }
    const text = [t.title, t.description, ...steps.flatMap((s) => [s.title, s.body])].join('\n');
    // (Thuật ngữ tenant cũ đã có test ở API chặn trên toàn repo.)
    expect(text).not.toMatch(/không gian làm việc|công ty/i);
  });
  it('tour-home bước 4 đúng cả máy tính lẫn cảm ứng (nhắc nút Tìm, không nói riêng Windows)', () => {
    const home = DEFAULT_GUIDES.find((g) => g.key === 'tour-home')!;
    const step = (home.content as TourContent).steps.find(
      (s) => s.selector === '[data-tour="cmdk-hint"]',
    )!;
    expect(step.body).toMatch(/nút Tìm/);
    expect(step.body).toMatch(/⌘K/);
    expect(step.body).toMatch(/Ctrl\+K/);
    expect(step.body).not.toMatch(/Windows/);
  });
  it('tour-integrations: các tab loại trừ nhau dùng chung MỘT bước `integrations-section`', () => {
    const steps = (
      DEFAULT_GUIDES.find((g) => g.key === 'tour-integrations')!.content as TourContent
    ).steps;
    expect(steps.map((s) => s.selector)).toEqual([
      '[data-tour="integrations-tabs"]',
      '[data-tour="integrations-section"]',
    ]);
  });
  it('chỉ tour Tổng quan tự chạy lần đầu', () => {
    expect(tours.filter((t) => (t.content as TourContent).autoStart).map((t) => t.key)).toEqual([
      'tour-home',
    ]);
  });
  it('tour-home version 2 (đổi chữ bước 4), guide cũ giữ version 1, guide mới version 1 và order 0; có tiêu đề + mô tả tiếng Việt', () => {
    for (const g of DEFAULT_GUIDES) {
      expect(g.version).toBe(g.key === 'tour-home' ? 2 : 1);
      if (g.type === 'TOUR') {
        expect(g.key).toMatch(/^tour-[a-z0-9-]+$/);
        expect(g.order).toBe(0);
      }
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.description.length).toBeGreaterThan(0);
    }
  });
});
