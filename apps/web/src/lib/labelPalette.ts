import type { CSSProperties } from 'react';
import {
  formatOklch,
  oklabDistance,
  oklchToRgb,
  parseHex,
  parseOklch,
  type Oklch,
  type Rgb,
} from './oklch';

/**
 * Bảng màu nhãn DUY NHẤT (8 màu) — dùng cho nhãn, nhóm, chương trình, mốc, vai trò (`ColorPicker`).
 * - Lưu xuống API: `hex` (sRGB của biến thể sáng, chữ thường) — cột chỉ nhận hex nên không cần migration.
 *   Vai trò lưu chuỗi OKLCH của biến thể sáng (`format: 'oklch'`) như trước.
 * - Hiển thị: KHÔNG dùng hex mà dùng token `--label-N` (chữ/chấm) và `--label-N-bg` (nền chip) ở `styles/globals.css`,
 *   có biến thể sáng/tối riêng. Giá trị ở đây PHẢI khớp token (test `labelPalette.test.ts` đọc CSS để kiểm).
 * - Chữ chip trên nền chip ≥ 4.5:1, chấm/swatch ≥ 3:1 trên nền trang — cả hai giao diện (cũng do test kiểm).
 */
export type LabelPaletteKey =
  | 'blue'
  | 'cyan'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'purple'
  | 'gray';

export interface LabelPaletteEntry {
  key: LabelPaletteKey;
  /** Tên tiếng Việt — tên truy cập của swatch. */
  name: string;
  /** Giá trị lưu: `#rrggbb` chữ thường của biến thể sáng. */
  hex: string;
  light: Oklch;
  dark: Oklch;
  bgLight: Oklch;
  bgDark: Oklch;
}

export const LABEL_PALETTE: readonly LabelPaletteEntry[] = [
  entry('blue', 'Xanh dương', '#3263c3', [0.52, 0.16, 262], [0.72, 0.13, 262], 0.03, 0.05),
  entry('cyan', 'Xanh lơ', '#087479', [0.51, 0.085, 200], [0.76, 0.1, 200], 0.03, 0.05),
  entry('green', 'Xanh lá', '#017b37', [0.51, 0.14, 150], [0.74, 0.14, 150], 0.03, 0.05),
  entry('yellow', 'Vàng', '#846305', [0.52, 0.105, 85], [0.82, 0.13, 85], 0.03, 0.05),
  entry('orange', 'Cam', '#a94e00', [0.53, 0.14, 50], [0.76, 0.14, 50], 0.03, 0.05),
  entry('red', 'Đỏ', '#c52b30', [0.54, 0.19, 25], [0.72, 0.17, 25], 0.03, 0.05),
  entry('purple', 'Tím', '#794db6', [0.52, 0.16, 300], [0.74, 0.13, 300], 0.03, 0.05),
  entry('gray', 'Xám', '#626a75', [0.52, 0.02, 256], [0.74, 0.02, 256], 0.01, 0.015),
];

/** Nền chip sáng L 0.95 / tối L 0.30 cùng sắc độ với chữ (độ bão hoà nền: `lc` sáng, `dc` tối). */
function entry(
  key: LabelPaletteKey,
  name: string,
  hex: string,
  light: Oklch,
  dark: Oklch,
  lc: number,
  dc: number,
): LabelPaletteEntry {
  return {
    key,
    name,
    hex,
    light,
    dark,
    bgLight: [0.95, lc, light[2]],
    bgDark: [0.3, dc, dark[2]],
  };
}

export type PaletteFormat = 'hex' | 'oklch';

/** Màu cũ thường sáng hơn bảng màu → so theo sắc độ là chính (độ sáng chỉ phá thế hoà). */
const TONE_LIGHTNESS_WEIGHT = 0.25;
const GRAY_INDEX = LABEL_PALETTE.length - 1;
const LIGHT_RGB: readonly Rgb[] = LABEL_PALETTE.map((e) => parseHex(e.hex) as Rgb);

/** Giá trị lưu của một màu: hex chữ thường, hoặc chuỗi OKLCH của biến thể sáng (vai trò). */
export function paletteValue(e: LabelPaletteEntry, format: PaletteFormat = 'hex'): string {
  return format === 'oklch' ? formatOklch(e.light) : e.hex;
}

/** Mục của bảng màu khớp CHÍNH XÁC với `value` (hex không phân biệt hoa/thường); không khớp → null. */
export function findPaletteEntry(
  value: unknown,
  format: PaletteFormat = 'hex',
): LabelPaletteEntry | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const lower = v.toLowerCase();
  if (format === 'oklch') return LABEL_PALETTE.find((e) => formatOklch(e.light) === lower) ?? null;
  return LABEL_PALETTE.find((e) => e.hex === lower) ?? null;
}

/**
 * Khoá so sánh hai giá trị màu: trong bảng màu → khoá của mục (`#C52B30` và `#c52b30` là MỘT màu); ngoài bảng → chữ thường
 * đã cắt khoảng trắng; trống → ''. Dùng để bấm lại màu đang chọn (chỉ khác hoa/thường) không phát `onChange`.
 */
export function colorKey(value: unknown, format: PaletteFormat = 'hex'): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const e = findPaletteEntry(value, format);
  return e ? `palette:${e.key}` : value.trim().toLowerCase();
}

export interface LabelTone {
  key: LabelPaletteKey;
  name: string;
  /** Biến CSS màu chữ/chấm (đổi theo giao diện nhờ `.dark`). */
  fg: string;
  /** Biến CSS nền chip. */
  bg: string;
  /** Màu cũ ngoài bảng màu được ánh xạ sang tông gần nhất (hoặc Xám khi không đọc được). */
  legacy: boolean;
}

function toneAt(index: number, legacy: boolean): LabelTone {
  const e = LABEL_PALETTE[index]!;
  const n = index + 1;
  return { key: e.key, name: e.name, fg: `var(--label-${n})`, bg: `var(--label-${n}-bg)`, legacy };
}

/** Màu bất kỳ (hex 3/6 chữ số hoặc `oklch(l c h)`) → sRGB; không đọc được → null. */
function toRgb(value: string): Rgb | null {
  const hex = parseHex(value);
  if (hex) return hex;
  const ok = parseOklch(value);
  return ok ? oklchToRgb(ok) : null;
}

/**
 * Tông hiển thị của màu nhãn lưu trong CSDL. Thuần, không ném lỗi:
 * - khớp bảng màu → tông đó; - hex/OKLCH lạ (nhãn cũ, ô màu native) → tông GẦN NHẤT (khoảng cách OKLab);
 * - trống/không đọc được → Xám. Luôn trả một tông của bảng màu nên chữ chip luôn đạt AA. KHÔNG sửa dữ liệu đã lưu.
 */
export function labelTone(color: unknown): LabelTone {
  if (typeof color !== 'string' || color.trim() === '') return toneAt(GRAY_INDEX, false);
  const exact = findPaletteEntry(color, 'hex') ?? findPaletteEntry(color, 'oklch');
  if (exact) return toneAt(LABEL_PALETTE.indexOf(exact), false);
  const rgb = toRgb(color.trim());
  if (!rgb) return toneAt(GRAY_INDEX, true);
  let best = 0;
  let bestD = Infinity;
  LIGHT_RGB.forEach((p, i) => {
    const d = oklabDistance(rgb, p, TONE_LIGHTNESS_WEIGHT);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return toneAt(best, true);
}

/** `style` của chip nhãn: chữ + nền theo token của tông (AA ở cả hai giao diện). */
export function labelToneStyle(color: unknown): CSSProperties {
  const t = labelTone(color);
  return { backgroundColor: t.bg, color: t.fg };
}
