import { fmtNumber } from '@/lib/locale';
import type { FilterVisibility, SavedFilter } from './api';

/** Chỉ CHỦ bộ lọc (có `filter:manage`) đổi được chia sẻ — khớp `requireOwned` + `@Permissions(FILTER_MANAGE)` ở máy chủ. */
export const canChangeFilterShare = (
  f: Pick<SavedFilter, 'isOwner'>,
  canManage: boolean,
): boolean => f.isOwner && canManage;

export type RouteFilterState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'missing' }
  | { state: 'found'; filter: SavedFilter };

/**
 * `/filters/:id` → bộ lọc cần nạp. Danh sách `GET /filters` CHỈ chứa bộ lọc người xem thấy (của mình, hoặc chia sẻ cho
 * họ — máy chủ đã lọc theo quyền), nên không có trong đó = "không thấy", KHÔNG phân biệt không tồn tại / đã xoá /
 * không có quyền (không lộ sự tồn tại của bộ lọc riêng tư).
 */
export function resolveRouteFilter(
  q: { data: readonly SavedFilter[] | undefined; isError: boolean },
  id: string | undefined,
): RouteFilterState {
  if (!id) return { state: 'none' };
  if (!q.data) return { state: q.isError ? 'error' : 'loading' };
  const filter = q.data.find((f) => f.id === id);
  return filter ? { state: 'found', filter } : { state: 'missing' };
}

/** Rail trang Bộ lọc: nhóm "Của tôi" và "Được chia sẻ với tôi" (giữ thứ tự máy chủ trả). */
export function splitByAccess(filters: readonly SavedFilter[]): {
  mine: SavedFilter[];
  shared: SavedFilter[];
} {
  return {
    mine: filters.filter((f) => f.access === 'owner'),
    shared: filters.filter((f) => f.access !== 'owner'),
  };
}

/** Bộ lọc từng chia sẻ nhưng mọi dự án/người được chia sẻ đã biến mất (xoá dự án, người nghỉ) — thực chất đang riêng tư. */
const LAPSED_LABEL = 'Riêng tư (không còn ai được chia sẻ)';

/**
 * Nhãn chia sẻ trên một hàng: "Riêng tư" hoặc "Chia sẻ · 2 dự án · 1 người" (chỉ đếm đích CÒN SỐNG — máy chủ đã bỏ dự án đã xoá/người đã nghỉ; không
 còn đích nào thì "Riêng tư (không còn ai được chia sẻ)"). Bộ lọc người khác chia sẻ chỉ mang phần họ được thấy nên không
 đếm hộ phần ẩn.
 */
export function shareLabel(
  f: Pick<SavedFilter, 'visibility' | 'sharedProjects' | 'sharedUsers' | 'access' | 'shareLapsed'>,
): string {
  if (f.access !== 'owner') return 'Được chia sẻ';
  if (f.shareLapsed) return LAPSED_LABEL;
  if (f.visibility === 'PRIVATE') return 'Riêng tư';
  const parts = [
    f.sharedProjects.length > 0 ? `${fmtNumber(f.sharedProjects.length)} dự án` : null,
    f.sharedUsers.length > 0 ? `${fmtNumber(f.sharedUsers.length)} người` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? `Chia sẻ · ${parts.join(' · ')}` : 'Chia sẻ';
}

/** Bản nháp trong hộp Chia sẻ. */
export interface ShareDraft {
  visibility: FilterVisibility;
  projectIds: string[];
  userIds: string[];
}

export const SHARE_NEEDS_TARGET = 'Chọn ít nhất một dự án hoặc một người để chia sẻ';

export const draftFrom = (
  f: Pick<SavedFilter, 'visibility' | 'sharedProjects' | 'sharedUsers'>,
): ShareDraft => ({
  visibility: f.visibility,
  projectIds: f.sharedProjects.map((p) => p.id),
  userIds: f.sharedUsers.map((u) => u.id),
});

/** Lỗi nhập: "Chia sẻ" mà chưa chọn dự án/người nào. */
export const draftError = (d: ShareDraft): string | null =>
  d.visibility === 'SHARED' && d.projectIds.length + d.userIds.length === 0
    ? SHARE_NEEDS_TARGET
    : null;

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Bản nháp khác bản đã lưu? ("Chỉ mình tôi" bỏ qua danh sách vì máy chủ xoá hết đích.) */
export const draftChanged = (a: ShareDraft, b: ShareDraft): boolean =>
  a.visibility !== b.visibility ||
  (a.visibility === 'SHARED' &&
    (!sameSet(a.projectIds, b.projectIds) || !sameSet(a.userIds, b.userIds)));

/** Phần PATCH `/filters/:id`: luôn gửi đủ ba trường để không còn đích cũ khi đổi. */
export function draftPatch(d: ShareDraft): {
  visibility: FilterVisibility;
  sharedProjectIds: string[];
  sharedUserIds: string[];
} {
  return d.visibility === 'PRIVATE'
    ? { visibility: 'PRIVATE', sharedProjectIds: [], sharedUserIds: [] }
    : { visibility: 'SHARED', sharedProjectIds: d.projectIds, sharedUserIds: d.userIds };
}
