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

/** Ngày bắt đầu `YYYY-MM-DD` (UTC, khớp cách máy chủ cắt ngày) của kỳ `days` ngày tính cả hôm nay. */
export function qaRangeFrom(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - (days - 1) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
