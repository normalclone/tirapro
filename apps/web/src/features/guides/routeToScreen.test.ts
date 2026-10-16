import { describe, expect, it } from 'vitest';
import type { ScreenGuide } from './api';
import { primaryTourOf, routeToScreen } from './routeToScreen';

describe('routeToScreen', () => {
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
