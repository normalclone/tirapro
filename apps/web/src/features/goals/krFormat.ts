import type { KeyResultUnit } from '@tirapro/types';
import { LOCALE } from '@/lib/locale';

interface KrLike {
  startValue: number;
  currentValue: number;
  targetValue: number;
  unit: KeyResultUnit;
  unitLabel: string | null;
}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Phần số theo đơn vị (không nhãn): % một chữ số thập phân, tiền theo locale, số hai chữ số. */
function formatNumber(value: number, unit: KeyResultUnit): string {
  if (unit === 'PERCENT') return `${round(value, 1)}%`;
  if (unit === 'CURRENCY') return new Intl.NumberFormat(LOCALE).format(value);
  return String(round(value, 2));
}

/** Giá trị KR kèm nhãn đơn vị ("4 bug"). Nhãn bị bỏ qua với PERCENT. */
export function formatKrValue(
  value: number,
  unit: KeyResultUnit,
  unitLabel?: string | null,
): string {
  const text = formatNumber(value, unit);
  const label = unit === 'PERCENT' ? '' : (unitLabel ?? '').trim();
  return label ? `${text} ${label}` : text;
}

/** Thay đổi so với lần trước: "−2", "+3", "0"; chưa có giá trị trước → rỗng. */
export function describeDelta(
  prev: number | null,
  next: number,
  kr?: { unit: KeyResultUnit },
): string {
  if (prev === null) return '';
  const d = round(next - prev, 2);
  const suffix = kr?.unit === 'PERCENT' ? '%' : '';
  if (d === 0) return '0';
  return `${d < 0 ? '−' : '+'}${Math.abs(d)}${suffix}`;
}

/** Dòng tóm tắt hành trình: "Bắt đầu 6 → 4 / 0 bug" (nhãn đơn vị chỉ ở đích). */
export function krSummary(kr: KrLike): string {
  const start = formatKrValue(kr.startValue, kr.unit, null);
  const current = formatKrValue(kr.currentValue, kr.unit, null);
  const target = formatKrValue(kr.targetValue, kr.unit, kr.unitLabel);
  return `Bắt đầu ${start} → ${current} / ${target}`;
}
