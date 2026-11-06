import type { TourContent } from '@tirapro/shared';
import { GuideType } from '@tirapro/types';
import { useScreenGuides, type ScreenGuide } from './api';

/**
 * Chuẩn hoá pathname cụ thể → screen pattern khớp với BE.
 * Vd `/p/PROJ-1/board` → `/p/:key/board`. Project key là segment sau `/p/`.
 * Đoạn động còn lại: `/issue/ABC-1` → `/issue/:key`, `/dashboards/<id>` → `/dashboards/:id`; mục con của
 * `/p/:key/config/*`, `/connect/integrations/*` và `/filters/<id>` gộp về một màn (mỗi nhóm một tour).
 */
export function routeToScreen(pathname: string): string {
  // Bỏ trailing slash (trừ root) trước, để mọi nhánh dưới đây không phải lo.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const proj = /^\/p\/[^/]+(\/.*)?$/.exec(path);
  if (proj) {
    const rest = proj[1] ?? '';
    if (rest === '/config' || rest.startsWith('/config/')) return '/p/:key/config';
    return `/p/:key${rest}`;
  }
  if (/^\/issue\/[^/]+$/.test(path)) return '/issue/:key';
  // `/dashboards/new` là thư viện mẫu, không phải một bảng cụ thể → giữ nguyên (trước luật `:id`).
  if (path === '/dashboards/new') return path;
  if (/^\/dashboards\/[^/]+$/.test(path)) return '/dashboards/:id';
  if (path === '/filters' || path.startsWith('/filters/')) return '/filters';
  if (path === '/connect/integrations' || path.startsWith('/connect/integrations/'))
    return '/connect/integrations';
  return path;
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
