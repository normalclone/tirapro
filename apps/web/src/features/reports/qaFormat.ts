/** Định dạng số cho mục "Chất lượng (QA)". Dấu thập phân là dấu phẩy, không phụ thuộc ICU của môi trường. */
const nf = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** < 1 giờ → "45 phút"; < 48 giờ → "5,2 giờ"; còn lại → "3,1 ngày"; null → "—". */
export function formatHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} phút`;
  if (h < 48) return `${nf(h)} giờ`;
  return `${nf(h / 24)} ngày`;
}

export const formatPercent = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

/** Chiều rộng thanh (%) theo giá trị lớn nhất; có giá trị thì tối thiểu 2% để vẫn nhìn thấy. */
export function barWidthPct(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/**
 * Kỳ `days` ngày tính cả hôm nay theo GIỜ ĐỊA PHƯƠNG của người xem: từ 00:00 ngày đầu tới 23:59:59.999 hôm nay,
 * gửi dưới dạng ISO (có `Z`) để máy chủ dùng nguyên văn — không bị cắt ngày theo UTC (lệch 7 giờ ở Việt Nam).
 */
export function qaRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Số bug đóng tối thiểu để tỷ lệ mở lại đủ ý nghĩa (1/4 bug = 25% không phải tín hiệu). */
const MIN_CLOSED_FOR_REOPEN_WARNING = 10;

/** Tô cảnh báo khi tỷ lệ mở lại >= 20% và mẫu đủ lớn. */
export const shouldWarnReopen = (rate: number | null, closed: number): boolean =>
  rate != null && rate >= 0.2 && closed >= MIN_CLOSED_FOR_REOPEN_WARNING;
