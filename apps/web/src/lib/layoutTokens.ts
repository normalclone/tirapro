import { BOTTOM_BAR_PX } from './bottomBar';

/** Lề của nút nổi (FAB) so với mép dưới/phải màn hình (= `bottom-6 right-6`). */
export const FAB_EDGE_PX = 24;

/**
 * Khoảng chừa phía dưới cho nút nổi: cao ~56px + lề 24px + 8px. Dùng chung cho Toaster (toast nằm TRÊN nút nổi)
 * và đệm đáy của vùng cuộn. Tailwind cần lớp tĩnh nên đệm (chỉ từ lg) dùng `lg:pb-24` (96px) / `lg:pb-28` (112px) — nếu đổi số này
 * hãy soát các lớp đó (test `layoutTokens.test.ts` kiểm các chỗ chính).
 */
export const FAB_CLEARANCE_PX = 88;

/**
 * Vị trí FAB/toast có tính vùng an toàn iOS (`viewport-fit=cover`): lề dưới/phải = max(24px, inset); toast nằm trên FAB
 * (`FAB_CLEARANCE_PX - FAB_EDGE_PX` = 64px = cao FAB 56 + hở 8) KỂ TỪ lề dưới đã nâng — nên FAB nâng lên 34px thì toast cũng nâng theo.
 */
export const FAB_BOTTOM_CSS = `max(${FAB_EDGE_PX}px, env(safe-area-inset-bottom))`;
export const FAB_RIGHT_CSS = `max(${FAB_EDGE_PX}px, env(safe-area-inset-right))`;
export const TOAST_BOTTOM_CSS = `calc(${FAB_BOTTOM_CSS} + ${FAB_CLEARANCE_PX - FAB_EDGE_PX}px)`;

/** Dưới `lg` (có thanh tab đáy, không có FAB): toast nằm trên thanh = cao thanh + vùng an toàn đáy + hở 8px. */
export const TOAST_BOTTOM_MOBILE_CSS = `calc(${BOTTOM_BAR_PX}px + env(safe-area-inset-bottom) + 8px)`;

/** Chiều cao thanh "thay đổi chưa lưu" (UnsavedBar, ~53px + viền) — nằm giữa <main> và thanh tab đáy nên toast phải nâng thêm. */
export const UNSAVED_BAR_PX = 56;

/**
 * Vị trí đáy của toast: từ lg theo FAB; dưới lg nằm trên thanh tab đáy, và khi đang có thay đổi chưa lưu thì
 * nâng thêm đúng chiều cao UnsavedBar để không che nút Lưu/Bỏ thay đổi.
 */
export function toastBottomCss(desktop: boolean, unsavedBarShown: boolean): string {
  if (desktop) return TOAST_BOTTOM_CSS;
  return unsavedBarShown
    ? `calc(${BOTTOM_BAR_PX}px + env(safe-area-inset-bottom) + 8px + ${UNSAVED_BAR_PX}px)`
    : TOAST_BOTTOM_MOBILE_CSS;
}
