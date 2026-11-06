/** Kết quả ghi nhận khi tour đóng: `complete` (xem hết và bấm "Xong") hay chỉ `seen` (đã mở/đã thấy). */
export type TourOutcome = 'complete' | 'seen';

/** Báo khi bấm "?" mà không có bước nào hiển thị được (trang đang tải, đang ở chế độ chỉnh sửa…). */
export const EMPTY_TOUR_MESSAGE =
  'Màn này chưa có gì để chỉ lúc này — chờ trang tải xong hoặc thoát chế độ chỉnh sửa rồi thử lại';

/** Không có bước nào → báo người dùng (thay vì im lặng) và trả `true` để nơi gọi dừng; có bước thì trả `false`. */
export function skipEmptyTour(stepCount: number, notify: (message: string) => void): boolean {
  if (stepCount > 0) return false;
  notify(EMPTY_TOUR_MESSAGE);
  return true;
}

/**
 * Chỉ "complete" khi người dùng đã XÁC NHẬN bước cuối bằng "Xong" (nút hoặc phím →, cùng hook `onNextClick`). Bỏ qua, ×, Esc,
 * bấm nền đều là "seen". API: `seen` đặt tiến độ SEEN (chặn auto-start lần sau, `seen: state !== null`) và KHÔNG hạ cấp
 * COMPLETED đã có (`guides.service`), nên bỏ qua không làm tour tự chạy lại và không làm mất "đã hoàn thành" cũ.
 */
export function tourOutcome(o: { finishedViaDone: boolean }): TourOutcome {
  return o.finishedViaDone ? 'complete' : 'seen';
}

/**
 * Trạng thái một lượt tour. `isLast` do `driver.isLastStep()` (activeIndex đổi NGAY khi `moveNext`, không chờ hiệu ứng ~400ms),
 * nên bấm "Xong" nhanh ngay sau khi tới bước cuối vẫn là hoàn thành — không dựa vào `onHighlighted` (bắn muộn → race cũ).
 * ArrowRight ở bước cuối cũng đi qua `next(true)`: bàn phím tương đương "Xong" — được tính là hoàn thành (chủ ý).
 */
export function createTourFlow() {
  let finishedViaDone = false;
  return {
    /** Nút "Tiếp/Xong" hoặc phím →: `finish` (đóng, hoàn thành) ở bước cuối, `move` (sang bước kế) ở bước khác. */
    next(isLast: boolean): 'move' | 'finish' {
      if (!isLast) return 'move';
      finishedViaDone = true;
      return 'finish';
    },
    outcome: (): TourOutcome => tourOutcome({ finishedViaDone }),
  };
}

/** Tiến độ guide trong cache sau khi đánh dấu (khớp API: `seen` không hạ cấp COMPLETED). */
export function applyGuideProgress<T extends { key: string; seen: boolean; state: string | null }>(
  guides: T[],
  key: string,
  action: TourOutcome,
): T[] {
  return guides.map((g) =>
    g.key !== key
      ? g
      : {
          ...g,
          seen: true,
          state: action === 'complete' || g.state === 'COMPLETED' ? 'COMPLETED' : 'SEEN',
        },
  );
}

/**
 * Sau khi driver.js đặt focus (nó focus phần tử focus được đầu tiên trong popover = ×), ta chuyển về nút chính để Enter đi
 * tiếp thay vì vô tình đóng. Chỉ khi focus đang trong popover hoặc đã rơi về body — focus nằm ở nơi khác (ô nhập của phần tử
 * được chỉ tới) thì không giật.
 */
export const shouldFocusPrimary = (o: {
  activeInPopover: boolean;
  activeIsBody: boolean;
}): boolean => o.activeInPopover || o.activeIsBody;

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

/**
 * Sau khi tour đóng: trả focus về phần tử đã mở tour (nút "?") nếu còn trong DOM. Không có (auto-start, Cmd+K) → không ép gì:
 * driver.js để focus về body — các chỗ kiểm "mất focus" (SplitButton, InlineText…) so với body nên đừng đưa focus vào `<main>`.
 */
export function restoreTourFocus(opener: Focusable | null | undefined): void {
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

/**
 * Bước nào chạy được: bỏ bước có selector mà không có phần tử hiển thị. Riêng bước ĐẦU (theo `order`) là khung của màn — vắng
 * nó nghĩa là màn đang ở trạng thái khác (không có quyền, đang tải, lỗi) → không chạy gì cả (trả rỗng → báo "chưa có gì để
 * chỉ"), thay vì vài bước lẻ trỏ vào chỗ không liên quan.
 */
export function runnableSteps<S extends { order: number; selector?: string | null }, E>(
  steps: readonly S[],
  find: (selector: string) => E | null,
): { step: S; el: E | null }[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const out: { step: S; el: E | null }[] = [];
  for (const [i, step] of sorted.entries()) {
    const el = step.selector ? find(step.selector) : null;
    if (step.selector && !el) {
      if (i === 0) return [];
      continue;
    }
    out.push({ step, el });
  }
  return out;
}
