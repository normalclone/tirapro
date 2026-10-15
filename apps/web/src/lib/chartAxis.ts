/** Margin biểu đồ recharts: KHÔNG dùng `left` âm — nó kéo nhãn trục Y ra ngoài khung và bị cắt. */
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

/** Chiều rộng trục Y đủ cho số lớn nhất (font 11px ≈ 7px/chữ số + 14px đệm), tối thiểu 36. */
export function yAxisWidth(values: number[]): number {
  const max = values.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  const digits = String(Math.round(max)).length;
  return Math.max(36, digits * 7 + 14);
}
