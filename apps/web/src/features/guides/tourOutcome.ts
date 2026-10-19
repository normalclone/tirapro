/** Kết quả ghi nhận khi tour đóng: `complete` (xem hết và bấm "Xong") hay chỉ `seen` (đã mở/đã thấy). */
export type TourOutcome = 'complete' | 'seen';

/**
 * Chỉ "complete" khi người dùng đã TỚI bước cuối và XÁC NHẬN bằng "Xong". Bỏ qua, ×, Esc, bấm nền đều là "seen" — kể cả khi
 * đã lướt tới bước cuối rồi thoát. API: `seen` đặt tiến độ SEEN (chặn auto-start lần sau, `seen: state !== null`) và KHÔNG hạ
 * cấp COMPLETED đã có (`guides.service`), nên bỏ qua không làm tour tự chạy lại và không làm mất "đã hoàn thành" cũ.
 */
export function tourOutcome(o: { reachedLast: boolean; finishedViaDone: boolean }): TourOutcome {
  return o.reachedLast && o.finishedViaDone ? 'complete' : 'seen';
}

export const SKIP_LABEL = 'Bỏ qua';

interface FooterLike {
  firstChild: unknown;
  querySelector: (sel: string) => unknown;
  insertBefore: (node: never, ref: never) => unknown;
}
interface ButtonLike {
  type: string;
  className: string;
  textContent: string | null;
  setAttribute: (k: string, v: string) => void;
  addEventListener: (ev: 'click', fn: () => void) => void;
}

/**
 * Chèn nút chữ "Bỏ qua" làm phần tử đầu của footer popover driver.js (bên trái; "Quay lại / Tiếp" ở bên phải). Nút thật
 * `<button type="button">` (tiếp cận bằng Tab/Enter/Space), idempotent. Tham số cấu trúc để test được không cần jsdom.
 */
export function ensureSkipButton(
  footer: FooterLike,
  doc: { createElement: (tag: 'button') => ButtonLike },
  onSkip: () => void,
): void {
  if (footer.querySelector('[data-tour-skip]')) return;
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'tour-skip-btn';
  b.textContent = SKIP_LABEL;
  b.setAttribute('data-tour-skip', '');
  b.addEventListener('click', onSkip);
  footer.insertBefore(b as never, footer.firstChild as never);
}

interface Focusable {
  isConnected: boolean;
  focus: (o?: { preventScroll: boolean }) => void;
}

/** Sau khi tour đóng: trả focus về phần tử đã mở tour (nút "?") nếu còn trong DOM; không thì về `<main>` (auto-start, Cmd+K). */
export function restoreTourFocus(
  opener: Focusable | null | undefined,
  main: Focusable | null | undefined,
): void {
  const target = opener?.isConnected ? opener : main;
  target?.focus({ preventScroll: true });
}
