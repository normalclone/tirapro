/** Hàng cuộn ngang (chip lọc, dải tab) trên màn hẹp: mờ mép báo còn nội dung + tự cuộn mục đang chọn vào khung. */

export interface ScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Sai số làm tròn (px) cho phép khi so sánh vị trí cuộn — scrollLeft có thể là số lẻ trên màn hình HiDPI. */
const EPS = 2;

/** Còn nội dung bị khuất ở mép đầu / mép cuối không? */
export function scrollFadeState(m: ScrollMetrics): { start: boolean; end: boolean } {
  return {
    start: m.scrollLeft > EPS,
    end: m.scrollLeft + m.clientWidth < m.scrollWidth - EPS,
  };
}

const FADE_PX = 24;

/** Giá trị `mask-image` mờ dần ở mép còn nội dung ('none' khi không có gì khuất). */
export function fadeMask(s: { start: boolean; end: boolean }): string {
  if (!s.start && !s.end) return 'none';
  const from = s.start ? `transparent 0, #000 ${FADE_PX}px` : '#000 0';
  const to = s.end ? `#000 calc(100% - ${FADE_PX}px), transparent 100%` : '#000 100%';
  return `linear-gradient(to right, ${from}, ${to})`;
}

/**
 * `scrollLeft` mới để mục nằm trọn trong khung (cách mép `pad`px), hoặc null nếu mục đã thấy đủ.
 * `offsetLeft` tính theo vùng nội dung của khung cuộn (khung phải là `position: relative`).
 */
export function revealScrollLeft(
  view: { scrollLeft: number; clientWidth: number },
  item: { offsetLeft: number; offsetWidth: number },
  pad = 16,
): number | null {
  const left = item.offsetLeft;
  const right = left + item.offsetWidth;
  if (left < view.scrollLeft + pad) return Math.max(0, left - pad);
  if (right > view.scrollLeft + view.clientWidth - pad) return right + pad - view.clientWidth;
  return null;
}
