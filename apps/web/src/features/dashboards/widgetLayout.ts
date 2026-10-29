/** Lưới 1/2/3 cột; trên mobile luôn 1 cột. Chuỗi class viết nguyên văn để Tailwind quét được. */
export const DASHBOARD_GRID_CLASS = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3';

export type WidgetWidth = 1 | 2 | 3;

/** Cỡ `w` (1–3) → số cột chiếm; ở màn vừa (2 cột) cỡ L chiếm cả hàng. */
export function widgetSpanClass(w: WidgetWidth): string {
  if (w === 3) return 'md:col-span-2 xl:col-span-3';
  if (w === 2) return 'md:col-span-2';
  return '';
}

export const WIDTH_LABEL: Record<WidgetWidth, string> = { 1: 'S', 2: 'M', 3: 'L' };
