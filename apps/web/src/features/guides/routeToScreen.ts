import type { TourContent } from '@tirapro/shared';
import { GuideType } from '@tirapro/types';
import { useScreenGuides, type ScreenGuide } from './api';

/**
 * Chuẩn hoá pathname cụ thể → screen pattern khớp với BE.
 * Vd `/p/PROJ-1/board` → `/p/:key/board`. Project key là segment sau `/p/`.
 */
export function routeToScreen(pathname: string): string {
  const m = /^\/p\/[^/]+(\/.*)?$/.exec(pathname);
  if (m) return `/p/:key${m[1] ?? ''}`.replace(/\/$/, '') || '/p/:key';
  // Bỏ trailing slash (trừ root) để khớp screen đã seed.
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** Type-guard: content có phải tour (có mảng steps) không. */
export function isTour(content: ScreenGuide['content']): content is TourContent {
  return !!content && Array.isArray((content as Partial<TourContent>).steps);
}

/** Tour chính của màn (đầu tiên theo thứ tự API trả về), hoặc undefined nếu màn không có tour. */
export function primaryTourOf(guides: ScreenGuide[] | undefined): ScreenGuide | undefined {
  return (guides ?? []).find((g) => g.type === GuideType.TOUR && isTour(g.content));
}

/** Màn có tour để chạy không (đang tải = false) — nút "?" và mục Cmd+K chỉ hiện khi true. */
export function useHasTour(screen: string): boolean {
  const { data } = useScreenGuides(screen);
  return primaryTourOf(data) !== undefined;
}
