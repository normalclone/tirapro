/** Lề của nút nổi (FAB) so với mép dưới/phải màn hình (= `bottom-6 right-6`). */
export const FAB_EDGE_PX = 24;

/**
 * Khoảng chừa phía dưới cho nút nổi: cao ~56px + lề 24px + 8px. Dùng chung cho Toaster (toast nằm TRÊN nút nổi)
 * và đệm đáy của vùng cuộn. Tailwind cần lớp tĩnh nên đệm dùng `pb-24` (96px) / `pb-28` (112px) — nếu đổi số này
 * hãy soát các lớp đó (test `layoutTokens.test.ts` kiểm các chỗ chính).
 */
export const FAB_CLEARANCE_PX = 88;
