import { describe, expect, it } from 'vitest';
import type { ScreenGuide } from './api';
import { primaryTourOf, routeToScreen } from './routeToScreen';

describe('routeToScreen', () => {
  it('chuẩn hoá đoạn động của màn công việc, bảng tổng quan, bộ lọc', () => {
    expect(routeToScreen('/issue/ABC-12')).toBe('/issue/:key');
    expect(routeToScreen('/issue/ABC-12/')).toBe('/issue/:key');
    expect(routeToScreen('/dashboards/ckx1y2z3')).toBe('/dashboards/:id');
    expect(routeToScreen('/dashboards/new')).toBe('/dashboards/:id');
    expect(routeToScreen('/filters')).toBe('/filters');
    expect(routeToScreen('/filters/ckx1y2z3')).toBe('/filters');
  });
  it('gộp các mục con của cấu hình dự án và tích hợp về một màn', () => {
    expect(routeToScreen('/p/ABC/config')).toBe('/p/:key/config');
    expect(routeToScreen('/p/ABC/config/general')).toBe('/p/:key/config');
    expect(routeToScreen('/p/ABC/config/workflow/')).toBe('/p/:key/config');
    expect(routeToScreen('/connect/integrations')).toBe('/connect/integrations');
    expect(routeToScreen('/connect/integrations/telegram')).toBe('/connect/integrations');
  });
  it('các màn tĩnh khác giữ nguyên', () => {
    expect(routeToScreen('/settings/import')).toBe('/settings/import');
    expect(routeToScreen('/connect/automation')).toBe('/connect/automation');
    expect(routeToScreen('/admin/organizations')).toBe('/admin/organizations');
    expect(routeToScreen('/issues')).toBe('/issues'); // không nhầm với /issue/:key
  });

  it('chuẩn hoá đường dẫn dự án về mẫu có :key', () => {
    expect(routeToScreen('/p/ABC/board')).toBe('/p/:key/board');
    expect(routeToScreen('/p/ABC/backlog')).toBe('/p/:key/backlog');
    expect(routeToScreen('/p/ABC')).toBe('/p/:key');
    expect(routeToScreen('/p/ABC/')).toBe('/p/:key');
  });
  it('bỏ dấu / cuối, giữ nguyên gốc', () => {
    expect(routeToScreen('/members/')).toBe('/members');
    expect(routeToScreen('/')).toBe('/');
    expect(routeToScreen('/settings/roles')).toBe('/settings/roles');
  });
});

const guide = (over: Partial<ScreenGuide>): ScreenGuide => ({
  id: 'g',
  key: 'k',
  type: 'TOUR',
  screen: '/',
  title: 't',
  description: null,
  content: { steps: [{ title: 'a', body: 'b', order: 0 }] },
  order: 0,
  seen: false,
  state: null,
  ...over,
});

describe('primaryTourOf — nút "?" và mục Cmd+K chỉ có khi màn có tour', () => {
  it('không có hướng dẫn / chưa tải / chỉ có checklist → không có tour (nút ẩn)', () => {
    expect(primaryTourOf(undefined)).toBeUndefined();
    expect(primaryTourOf([])).toBeUndefined();
    expect(
      primaryTourOf([guide({ type: 'CHECKLIST', content: { items: [{ key: 'a', label: 'A' }] } })]),
    ).toBeUndefined();
  });
  it('lấy tour đầu tiên, bỏ qua checklist', () => {
    const a = guide({ key: 'empty', content: { steps: [] } });
    const b = guide({ key: 'real' });
    expect(primaryTourOf([guide({ type: 'CHECKLIST', content: { items: [] } }), b])?.key).toBe(
      'real',
    );
    expect(primaryTourOf([a])?.key).toBe('empty'); // mảng steps rỗng vẫn là tour hợp lệ (runTour tự bỏ qua)
  });
});
