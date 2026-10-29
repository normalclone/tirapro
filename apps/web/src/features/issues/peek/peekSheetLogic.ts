/** Hai bề mặt của xem nhanh: sheet đáy (modal) dưới md, panel cột phải (phi-modal) từ md. */
export type PeekSurface = 'sheet' | 'panel';
/** Hai nấc chiều cao của sheet: nửa màn hình và gần toàn màn hình. */
export type PeekSnap = 'half' | 'full';

/**
 * Từ md (768px) trở lên giữ panel phi-modal (cột tĩnh ≥ lg, ngăn kéo ≤30rem ở 768–1023) để bấm hết dòng này sang dòng khác trên
 * máy tính bảng. Dưới md mới dùng sheet đáy.
 */
export const PEEK_DESKTOP_QUERY = '(min-width: 768px)';

/** Thời gian giữ sheet sau khi đóng cho hiệu ứng trượt xuống (token `slow` 240ms + dư). */
export const SHEET_EXIT_MS = 400;

export const peekSurface = (isMdUp: boolean): PeekSurface => (isMdUp ? 'panel' : 'sheet');

/** Có đang ở khung nhìn dùng sheet không — đọc tại thời điểm gọi (cho `open`/`close` ổn định, không đăng ký lắng nghe). */
export function isPeekSheetViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return !window.matchMedia(PEEK_DESKTOP_QUERY).matches;
}

/** Thuộc tính đặt lên khung danh sách khi sheet che nửa dưới màn hình (CSS chừa `scroll-margin-bottom` cho các mục). */
export const PEEK_SHEET_HALF_ATTR = 'data-peek-sheet-half';
export const sheetCoversListBottom = (open: boolean, snap: PeekSnap): boolean =>
  open && snap === 'half';

export const nextSnap = (s: PeekSnap): PeekSnap => (s === 'half' ? 'full' : 'half');
export const snapToggleLabel = (s: PeekSnap): string => (s === 'half' ? 'Mở rộng' : 'Thu gọn');

/**
 * Class chiều cao của sheet (đè `max-h-[85dvh]` mặc định của Dialog đáy). Chuyển chiều cao `ease-out-expo` — không overshoot
 * (DESIGN cấm nảy); `motion-reduce` đổi nấc tức thời.
 */
export function sheetClass(snap: PeekSnap): string {
  return [
    'max-h-none transition-[height] duration-slow ease-out-expo motion-reduce:transition-none focus:outline-none',
    snap === 'half' ? 'h-[50dvh]' : 'h-[calc(100dvh-env(safe-area-inset-top))]',
  ].join(' ');
}

/**
 * Esc trong sheet (Radix nghe ở pha bắt nên chạy TRƯỚC mọi handler bên trong):
 * - `keep`: bộ gõ đang soạn (Esc thuộc về bộ gõ) hoặc đang sửa tiêu đề tại chỗ (ô tự huỷ sửa) → không đóng.
 * - `blur`: ô nhập đang có chữ chưa gửi → chỉ rời ô (nháp còn), Esc sau mới đóng — như panel phi-modal.
 * - `close`: còn lại.
 */
export function sheetEscapeAction(o: {
  isComposing: boolean;
  inInlineEdit: boolean;
  draftFocused: boolean;
}): 'close' | 'keep' | 'blur' {
  if (o.isComposing || o.inInlineEdit) return 'keep';
  return o.draftFocused ? 'blur' : 'close';
}

/**
 * Cách đổi `?peek=` trong lịch sử trình duyệt.
 * - Desktop/panel và đổi việc khi đang mở (‹ ›, j/k): `replace` (không chồng lịch sử) — như trước đây.
 * - Mở sheet từ trạng thái đóng: `push`, đánh dấu mục bằng state `peekPushed` → nút Back của Android/trình duyệt đóng sheet
 *   thay vì rời trang.
 * - Đóng: mục do mình đẩy → `back` (không để lại mục thừa); vào thẳng bằng URL → `replace` (không lùi ra khỏi trang);
 *   chưa mở → `noop` (đóng hai lần không lùi hai bước).
 */
export function peekNavPlan(o: {
  sheet: boolean;
  hasPeek: boolean;
  pushed: boolean;
  key: string | null;
}): 'push' | 'replace' | 'back' | 'noop' {
  if (o.key !== null) return !o.hasPeek && o.sheet ? 'push' : 'replace';
  if (!o.hasPeek) return 'noop';
  return o.pushed ? 'back' : 'replace';
}

/**
 * Phần tử của việc `key` trong khung danh sách để trả focus khi đóng: `[data-nav-item][data-issue-key]` (Board/Backlog/Bộ lọc/Cây),
 * hoặc `[data-nav-item]` bên trong phần tử mang `data-issue-key` (Việc mới vào), cuối cùng chính phần tử `data-issue-key`.
 * Dòng đã gỡ khỏi DOM (ảo hoá) → null.
 */
export function findPeekSource(root: ParentNode | null, key: string): HTMLElement | null {
  if (!root) return null;
  const k = key.replace(/(["\\])/g, '\\$1');
  return (
    root.querySelector<HTMLElement>(`[data-nav-item][data-issue-key="${k}"]`) ??
    root.querySelector<HTMLElement>(`[data-issue-key="${k}"] [data-nav-item]`) ??
    root.querySelector<HTMLElement>(`[data-issue-key="${k}"]`)
  );
}
