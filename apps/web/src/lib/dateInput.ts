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

/**
 * Mặt nạ gõ ngày: giữ chữ số, tự chèn `/` sau 2 và 4 số (`0508` → `05/08`). Dấu `/ . -` gõ tay chốt phần
 * ngày/tháng đang gõ và đệm `0` nếu chỉ có 1 chữ số (`5/8/2026` → `05/08/2026`, `5/` → `05/`).
 */
export function maskViDate(raw: string): string {
  return maskParts(raw, /[/.-]/, '/', [2, 2, 4]);
}

/** Máy trạng thái chung cho mặt nạ ngày/giờ: `limits[i]` = số chữ số tối đa của phần thứ i. */
function maskParts(raw: string, sep: RegExp, joiner: string, limits: number[]): string {
  const parts = [''];
  for (const ch of raw) {
    const i = parts.length - 1;
    const limit = limits[i] ?? 0;
    if (/\d/.test(ch)) {
      if ((parts[i] ?? '').length < limit) parts[i] += ch;
      else if (i + 1 < limits.length) parts.push(ch);
    } else if (sep.test(ch) && parts[i] !== '' && i + 1 < limits.length) {
      parts[i] = (parts[i] ?? '').padStart(2, '0');
      parts.push('');
    }
  }
  return parts.join(joiner);
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

/** Mặt nạ gõ giờ `HH:mm`: chữ số (tối đa 4), `:` sau 2 số; `9:` → `09:`. */
export function maskViTime(raw: string): string {
  return maskParts(raw, /:/, ':', [2, 2]);
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

const DATE_ERR = 'Ngày chưa đúng (dd/MM/yyyy)';
const RANGE_ERR = 'Ngày nằm ngoài khoảng cho phép';

/**
 * Thông điệp lỗi của chữ đang gõ trong một ô ngày ('' nếu trống hoặc hợp lệ): chữ không thành ngày thật → câu chuẩn;
 * ngày nằm ngoài [min, max] → `rangeError` (nơi dùng nên nói rõ, vd "Ngày kết thúc không được trước ngày bắt đầu").
 */
export function dateFieldError(
  text: string,
  min?: string,
  max?: string,
  rangeError: string = RANGE_ERR,
): string {
  if (text === '') return '';
  const iso = parseViDate(text);
  if (iso === null) return DATE_ERR;
  return inDateRange(iso, min, max) ? '' : rangeError;
}
