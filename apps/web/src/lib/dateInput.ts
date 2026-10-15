/**
 * Logic thuần cho ô nhập ngày `dd/MM/yyyy` và giờ `HH:mm` (24h) — dùng bởi `DateInput`/`DateTimeInput`.
 * Không dùng `Date` để khỏi lệch múi giờ: kiểm tra ngày bằng bảng số ngày/tháng + năm nhuận.
 * Giá trị trao đổi là chuỗi ISO cục bộ: `yyyy-MM-dd` / `yyyy-MM-ddTHH:mm`.
 */

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const pad2 = (n: number) => String(n).padStart(2, '0');

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Chỉ giữ chữ số (tối đa 8), tự chèn `/` sau 2 và 4 số: `0508` → `05/08`. */
export function maskViDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '/' + d.slice(2, 4);
  if (d.length > 4) out += '/' + d.slice(4, 8);
  return out;
}

/**
 * `5/8/2026`, `05-08-2026`, `5.8.26`, `05082026` → `2026-08-05`. Năm 2 chữ số → 20yy.
 * Trả null nếu không đủ 3 phần, ngày không có thật hoặc năm ngoài 1900–2100.
 */
export function parseViDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let d: string, m: string, y: string;
  const parts = s.split(/[/.-]/);
  if (parts.length === 3) {
    [d, m, y] = parts as [string, string, string];
  } else if (/^\d{8}$/.test(s)) {
    d = s.slice(0, 2);
    m = s.slice(2, 4);
    y = s.slice(4);
  } else return null;
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^(\d{2}|\d{4})$/.test(y)) return null;
  const day = Number(d);
  const month = Number(m);
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** `2026-08-05` → `05/08/2026` (không qua múi giờ); không hợp lệ → ''. */
export function formatViDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Chữ số → `HH:mm` (tối đa 4 số, chèn `:` sau 2 số). */
export function maskViTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/** `9:30`, `0930`, `09:30` → `09:30`; giờ 0–23, phút 0–59; không hợp lệ → null. */
export function parseViTime(raw: string): string | null {
  const s = raw.trim();
  let h: string, m: string;
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) [, h, m] = colon as unknown as [string, string, string];
  else if (/^\d{4}$/.test(s)) {
    h = s.slice(0, 2);
    m = s.slice(2);
  } else return null;
  const hh = Number(h);
  const mm = Number(m);
  if (hh > 23 || mm > 59) return null;
  return `${pad2(hh)}:${pad2(mm)}`;
}

/** Ghép `yyyy-MM-dd` + `HH:mm` → `yyyy-MM-ddTHH:mm`; ngày trống → ''; giờ trống → 00:00. */
export function joinDateTime(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
}

/** Tách `yyyy-MM-ddTHH:mm[:ss]` → { date, time }; trống/không hợp lệ → rỗng. */
export function splitDateTime(v: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
  return m ? { date: m[1] ?? '', time: m[2] ?? '' } : { date: '', time: '' };
}

/** `iso` có nằm trong [min, max] (chuỗi `yyyy-MM-dd`, so sánh từ điển) không. */
export function inDateRange(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}
