/** Phần thuần của `BulletBar` (hình học thanh, chữ chênh lệch, bản thay thế bằng chữ cho trình đọc màn hình). */

export interface BulletMarker {
  at: number;
  label: string;
}

export interface BulletGeometry {
  /** Thang của thanh (= `aria-valuemax`), luôn > 0. */
  max: number;
  /** Giá trị đã kẹp vào [0, max] (= `aria-valuenow`, luôn hợp lệ ARIA). */
  now: number;
  /** 0–100, độ dài phần đã đạt. */
  fillPct: number;
  /** 0–100, vị trí vạch đích; null khi không có đích hợp lệ. */
  targetPct: number | null;
  markers: Array<{ label: string; at: number; pct: number }>;
}

const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPct = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;

/** Số gọn: làm tròn 1 chữ số thập phân, bỏ ".0"; không hữu hạn → "0". */
export function fmtNum(n: number): string {
  return finite(n) ? String(round1(n)) : '0';
}

/** Số kèm đơn vị: "%" dính liền, đơn vị chữ cách một khoảng. */
function withUnit(n: number, unit?: string): string {
  const v = fmtNum(n);
  if (!unit) return v;
  return unit === '%' ? `${v}%` : `${v} ${unit}`;
}

/**
 * Hình học thanh. Có `max` hợp lệ (> 0) → dùng làm thang; không thì thang = lớn nhất của giá trị/đích/marker (vượt đích
 * vẫn nằm trong thanh, vạch đích dời về trái), tối thiểu 1 để không chia cho 0. Mọi giá trị kẹp 0–100.
 */
export function bulletGeometry(spec: {
  value: number;
  target?: number | null;
  max?: number | null;
  markers?: BulletMarker[];
}): BulletGeometry {
  const value = finite(spec.value) && spec.value > 0 ? spec.value : 0;
  const target = finite(spec.target) && spec.target >= 0 ? spec.target : null;
  const markers = (spec.markers ?? []).filter((m) => finite(m.at) && m.at >= 0);
  const max =
    finite(spec.max) && spec.max > 0
      ? spec.max
      : Math.max(value, target ?? 0, ...markers.map((m) => m.at)) || 1;
  return {
    max,
    now: Math.min(value, max),
    fillPct: clampPct((value / max) * 100),
    targetPct: target === null ? null : clampPct((target / max) * 100),
    markers: markers.map((m) => ({ label: m.label, at: m.at, pct: clampPct((m.at / max) * 100) })),
  };
}

/** "so với cam kết +4" / "so với cam kết −4" / "đúng cam kết" (chênh lệch làm tròn 1 chữ số). */
export function bulletDelta(
  value: number,
  target: number,
  targetLabel: string,
  unit?: string,
): string {
  const diff = round1((finite(value) ? value : 0) - (finite(target) ? target : 0));
  if (diff === 0) return `đúng ${targetLabel}`;
  const sign = diff > 0 ? '+' : '−';
  return `so với ${targetLabel} ${sign}${withUnit(Math.abs(diff), unit)}`;
}

/** Bản thay thế bằng chữ ĐẦY ĐỦ (số thật, không kẹp) cho `aria-valuetext` — màu/vạch không phải kênh duy nhất. */
export function bulletValueText(spec: {
  label: string;
  value: number;
  target?: number | null;
  max?: number | null;
  targetLabel?: string;
  unit?: string;
  markers?: BulletMarker[];
}): string {
  const { label, value, target, max, unit } = spec;
  const targetLabel = spec.targetLabel ?? 'đích';
  const parts: string[] = [];
  if (finite(target) && target >= 0) {
    parts.push(
      withUnit(value, unit),
      `${targetLabel} ${withUnit(target, unit)}`,
      bulletDelta(value, target, targetLabel, unit),
    );
  } else if (finite(max) && max > 0 && !(unit === '%' && max === 100)) {
    parts.push(`${fmtNum(value)}/${fmtNum(max)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`);
  } else {
    parts.push(withUnit(value, unit));
  }
  for (const m of spec.markers ?? []) {
    if (finite(m.at) && m.at >= 0) parts.push(`${m.label} ${withUnit(m.at, unit)}`);
  }
  return `${label}: ${parts.join(', ')}`;
}
