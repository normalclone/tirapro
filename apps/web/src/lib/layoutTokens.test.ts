import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAB_BOTTOM_CSS,
  FAB_CLEARANCE_PX,
  FAB_EDGE_PX,
  FAB_RIGHT_CSS,
  TOAST_BOTTOM_CSS,
  TOAST_BOTTOM_MOBILE_CSS,
  UNSAVED_BAR_PX,
  toastBottomCss,
} from './layoutTokens';
import { BOTTOM_BAR_PX } from './bottomBar';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('FAB không che nội dung', () => {
  it('Toaster có offset để né FAB', () =>
    expect(src('App.tsx')).toMatch(/<Toaster[\s\S]*?offset=/));
  it('Toaster dùng toastBottomCss (hằng tính vùng an toàn, không số cứng)', () =>
    expect(src('App.tsx')).toMatch(/toastBottomCss/));
  it('PageFrame chừa đệm đáy cho FAB', () => {
    const page = src('components/layout/PageFrame.tsx');
    expect(page).toMatch(/\bpb-8\b[^'"]*\blg:pb-28\b/);
    expect(page.replace(/lg:pb-28/g, '')).not.toMatch(/\bpb-28\b/);
    expect(page).not.toMatch(/\bpy-8\b/);
  });
  it('FAB dùng hằng cạnh thay số cứng', () => {
    expect(src('components/layout/FloatingActions.tsx')).toMatch(/FAB_BOTTOM_CSS/);
    expect(src('components/layout/FloatingActions.tsx')).not.toMatch(/bottom-6 right-6/);
  });
  it('khoảng chừa toast lớn hơn chiều cao FAB + lề (56 + 24)', () =>
    expect(FAB_CLEARANCE_PX).toBeGreaterThanOrEqual(56 + FAB_EDGE_PX));
  it('các vùng cuộn toàn màn có đệm đáy', () => {
    for (const f of [
      'features/board/BoardPage.tsx',
      'features/backlog/BacklogPage.tsx',
      'features/triage/TriagePage.tsx',
      'features/tree/TreePage.tsx',
      'features/gantt/GanttPage.tsx',
    ])
      expect(src(f), f).toMatch(/\blg:pb-2[48]\b/);
  });
  it('thanh thao tác hàng loạt né FAB chỉ từ lg (lg:mr-24); dưới lg không còn FAB nên không chừa mb-24, nằm sát thanh tab đáy', () => {
    const bar = src('features/backlog/BulkActionBar.tsx');
    expect(bar).toMatch(/lg:mr-24/);
    // Cha `space-y-4` ghi đè margin-bottom của con nên không đặt mb-* (lớp chết đã bỏ ở đợt 2A).
    expect(bar).not.toMatch(/\bmb-\d+\b|\blg:mb-\d+\b/);
  });
  it('FAB và toast tính vùng an toàn iOS; toast luôn nằm trên FAB kể cả khi FAB được nâng', () => {
    expect(FAB_BOTTOM_CSS).toBe(`max(${FAB_EDGE_PX}px, env(safe-area-inset-bottom))`);
    expect(FAB_RIGHT_CSS).toMatch(/safe-area-inset-right/);
    // Toast = lề dưới ĐÃ nâng của FAB + (cao FAB 56 + hở 8): cùng biểu thức nên luôn cao hơn đỉnh FAB ≥ 8px.
    expect(TOAST_BOTTOM_CSS).toBe(`calc(${FAB_BOTTOM_CSS} + ${FAB_CLEARANCE_PX - FAB_EDGE_PX}px)`);
    expect(FAB_CLEARANCE_PX - FAB_EDGE_PX).toBeGreaterThanOrEqual(56 + 8);
  });
  it('dưới lg toast nằm trên thanh tab đáy: cao thanh + vùng an toàn + 8px; trên lg vẫn theo FAB', () => {
    expect(BOTTOM_BAR_PX).toBe(56);
    expect(TOAST_BOTTOM_MOBILE_CSS).toBe('calc(56px + env(safe-area-inset-bottom) + 8px)');
    expect(src('App.tsx')).toMatch(/toastBottomCss\(desktop,/);
  });
  it('toast tránh thanh "thay đổi chưa lưu": chỉ dưới lg và chỉ khi đang dirty', () => {
    expect(UNSAVED_BAR_PX).toBeGreaterThanOrEqual(53);
    expect(toastBottomCss(true, false)).toBe(TOAST_BOTTOM_CSS);
    expect(toastBottomCss(true, true)).toBe(TOAST_BOTTOM_CSS); // desktop: bar không nằm dưới toast
    expect(toastBottomCss(false, false)).toBe(TOAST_BOTTOM_MOBILE_CSS);
    expect(toastBottomCss(false, true)).toBe(
      `calc(${BOTTOM_BAR_PX}px + env(safe-area-inset-bottom) + 8px + ${UNSAVED_BAR_PX}px)`,
    );
    expect(src('App.tsx')).toMatch(/toastBottomCss\(/);
  });
  it('thanh tab đáy đệm vùng an toàn đáy và là con flex (không fixed)', () => {
    const bar = src('components/layout/BottomTabBar.tsx');
    expect(bar).toMatch(/safe-area-inset-bottom/);
    expect(bar).not.toMatch(/className=(?:"|\{`)[^"`]*\bfixed\b/);
    expect(bar).toMatch(/h-\[55px\]/);
  });
  it('FAB chỉ mount từ lg (dưới lg đã có thanh tab đáy)', () =>
    expect(src('components/layout/AppShell.tsx')).toMatch(/DESKTOP_MIN_QUERY/));
  it('khung gốc đệm vùng an toàn trái/phải (viewport-fit=cover)', () => {
    const css = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    expect(css).toMatch(/#root\s*\{[^}]*safe-area-inset-left[^}]*\}/);
    expect(css).toMatch(/#root\s*\{[^}]*safe-area-inset-right[^}]*\}/);
    // Không còn phần tử `fixed` tự đệm riêng (drawer đã bỏ; thanh tab đáy là con flex nằm trong #root đã đệm trái/phải).
    expect(src('components/layout/AppShell.tsx')).not.toMatch(/\bfixed\b[^'"]*\binset-y-0\b/);
  });
});
