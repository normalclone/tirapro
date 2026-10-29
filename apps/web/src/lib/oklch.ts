/**
 * Toán màu thuần cho bảng màu nhãn (`labelPalette`): OKLCH ↔ sRGB, tỉ lệ tương phản WCAG, khoảng cách màu OKLab.
 * Không phụ thuộc DOM/thư viện — test được trong vitest node.
 */

export type Oklch = readonly [l: number, c: number, h: number];
export type Rgb = readonly [r: number, g: number, b: number];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** OKLCH → OKLab (a, b theo chroma/hue). */
function toLab([l, c, h]: Oklch): [number, number, number] {
  return [l, c * Math.cos(toRad(h)), c * Math.sin(toRad(h))];
}

/** OKLCH → sRGB TUYẾN TÍNH (có thể ngoài [0,1] khi màu ngoài gam sRGB). */
function toLinearRgb(color: Oklch): [number, number, number] {
  const [l, a, b] = toLab(color);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [lc, mc, sc] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

const encodeGamma = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const decodeGamma = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

/** Màu nằm trong gam sRGB (không bị cắt khi đổi sang hex)? */
export function inSrgbGamut(color: Oklch): boolean {
  return toLinearRgb(color).every((v) => v >= -0.0005 && v <= 1.0005);
}

/** OKLCH → sRGB 0–255 (làm tròn; cắt nếu ngoài gam). */
export function oklchToRgb(color: Oklch): Rgb {
  const [r, g, b] = toLinearRgb(color).map((v) => Math.round(encodeGamma(clamp01(v)) * 255));
  return [r!, g!, b!];
}

/** OKLCH → `#rrggbb` (chữ thường). */
export function oklchToHex(color: Oklch): string {
  return `#${oklchToRgb(color)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** `#rrggbb` hoặc `#rgb` (không phân biệt hoa/thường) → sRGB 0–255; không phải hex → null. */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  const m6 = /^#([0-9a-f]{6})$/i.exec(s);
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  const hex = m6 ? m6[1]! : m3 ? [...m3[1]!].map((c) => c + c).join('') : null;
  if (!hex) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** sRGB 0–255 → OKLab. */
function rgbToLab([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map((v) => decodeGamma(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Khoảng cách Euclid trong OKLab giữa hai màu sRGB (càng nhỏ càng giống). `lightnessWeight` < 1 giảm ảnh hưởng của độ
 * sáng để so theo SẮC ĐỘ (màu cũ sáng hơn bảng màu vẫn về đúng họ màu).
 */
export function oklabDistance(a: Rgb, b: Rgb, lightnessWeight = 1): number {
  const [l1, a1, b1] = rgbToLab(a);
  const [l2, a2, b2] = rgbToLab(b);
  return Math.hypot((l1 - l2) * lightnessWeight, a1 - a2, b1 - b2);
}

/** Độ sáng tương đối WCAG của một màu OKLCH (màu ngoài gam bị cắt như khi hiển thị). */
function luminance(color: Oklch): number {
  const [r, g, b] = toLinearRgb(color).map((v) => clamp01(v)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tỉ lệ tương phản WCAG 2.x giữa hai màu OKLCH (1–21). Chữ thường cần ≥ 4.5, thành phần giao diện ≥ 3. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `oklch(0.52 0.16 262)` → [0.52, 0.16, 262]; không đúng dạng (hoặc có alpha) → null. */
export function parseOklch(input: string | null | undefined): Oklch | null {
  if (typeof input !== 'string') return null;
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(input.trim());
  if (!m) return null;
  const v: Oklch = [Number(m[1]), Number(m[2]), Number(m[3])];
  return v.every(Number.isFinite) ? v : null;
}

/** [l, c, h] → `oklch(l c h)` đúng cách ghi ở `styles/globals.css`. */
export function formatOklch([l, c, h]: Oklch): string {
  return `oklch(${l} ${c} ${h})`;
}
