import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDES } from './default-guides';
import type { TourContent } from './guides';

const tours = DEFAULT_GUIDES.filter((g) => g.type === 'TOUR');
describe('DEFAULT_GUIDES', () => {
  it('khoá duy nhất, đúng 5 tour cho 5 màn chính', () => {
    expect(new Set(DEFAULT_GUIDES.map((g) => g.key)).size).toBe(DEFAULT_GUIDES.length);
    expect(tours.map((t) => t.screen).sort()).toEqual(
      ['/', '/members', '/p/:key/backlog', '/p/:key/board', '/settings/roles'].sort(),
    );
  });
  it.each(tours)('$key: 3–5 bước, thứ tự 0..n-1 liên tục, selector dạng data-tour', (t) => {
    const steps = (t.content as TourContent).steps;
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);
    expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i));
    for (const s of steps)
      if (s.selector) expect(s.selector).toMatch(/^\[data-tour="[a-z0-9-]+"\]$/);
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
  it('chỉ tour Tổng quan tự chạy lần đầu', () => {
    expect(tours.filter((t) => (t.content as TourContent).autoStart).map((t) => t.key)).toEqual([
      'tour-home',
    ]);
  });
  it('tour-home version 2 (đổi chữ bước 4), guide còn lại version 1; có tiêu đề + mô tả tiếng Việt', () => {
    for (const g of DEFAULT_GUIDES) {
      expect(g.version).toBe(g.key === 'tour-home' ? 2 : 1);
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.description.length).toBeGreaterThan(0);
    }
  });
});
