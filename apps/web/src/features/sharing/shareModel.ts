import { DASHBOARD_SCOPES, type DashboardScopeValue } from '@tirapro/shared';
import type { SearchSelectOption } from '@/components/ui/SearchSelect';
import type { FilterVisibility } from '@/features/saved-filters/api';

/** Mức chia sẻ dùng chung cho hộp chia sẻ: của bảng tổng quan (4 mức); bộ lọc dùng 3 mức đầu (GLOBAL = WORKSPACE). */
export type ShareKind = DashboardScopeValue;

export interface ShareValue {
  scope: ShareKind;
  projectId: string;
  teamId: string;
}

export const DASHBOARD_SHARE_KINDS: readonly ShareKind[] = DASHBOARD_SCOPES;
export const FILTER_SHARE_KINDS: readonly ShareKind[] = ['PRIVATE', 'GLOBAL', 'PROJECT'];

/** Lời giải thích mức chia sẻ theo loại đối tượng được chia sẻ. */
export interface ShareCopy {
  noun: string;
  /** Câu nói dữ liệu bên trong vẫn theo quyền người xem (ghép sau dấu `;`). */
  dataNote: string;
}
export const DASHBOARD_COPY: ShareCopy = {
  noun: 'bảng tổng quan',
  dataNote: 'dữ liệu từng ô vẫn theo quyền của người xem',
};
export const FILTER_COPY: ShareCopy = {
  noun: 'bộ lọc',
  dataNote: 'kết quả vẫn theo quyền của người xem',
};

/**
 * Bộ lọc → giá trị của hộp chia sẻ. `PROJECT` mà chưa gắn dự án (dữ liệu cũ: biểu mẫu tạo từng cho chọn "Dự án" không kèm
 * dự án) thì máy chủ cho cả không gian thấy (`visibilityScope`) → hộp hiện đúng "Cả không gian làm việc", không nói sai.
 */
export function filterShareValue(f: {
  visibility: FilterVisibility;
  sharedProjectId: string | null;
}): ShareValue {
  if (f.visibility === 'PRIVATE') return { scope: 'PRIVATE', projectId: '', teamId: '' };
  if (f.visibility === 'PROJECT' && f.sharedProjectId) {
    return { scope: 'PROJECT', projectId: f.sharedProjectId, teamId: '' };
  }
  return { scope: 'GLOBAL', projectId: '', teamId: '' };
}

/** Giá trị hộp chia sẻ → phần PATCH `/filters/:id`: luôn gửi cả hai trường để dự án cũ không ở lại khi đổi mức. */
export function filterSharePatch(v: ShareValue): {
  visibility: FilterVisibility;
  sharedProjectId: string | null;
} {
  if (v.scope === 'PRIVATE') return { visibility: 'PRIVATE', sharedProjectId: null };
  if (v.scope === 'PROJECT') return { visibility: 'PROJECT', sharedProjectId: v.projectId };
  return { visibility: 'WORKSPACE', sharedProjectId: null };
}

export const sameShare = (a: ShareValue, b: ShareValue): boolean =>
  a.scope === b.scope && a.projectId === b.projectId && a.teamId === b.teamId;

/**
 * Dự án mời chọn: những dự án NGƯỜI SỬA thấy (máy chủ đã lọc theo quyền; `assertSharedProjectVisible`/`assertCanSee` còn chặn
 * lần nữa) và chưa lưu trữ. Dự án đang gắn luôn hiện kể cả khi vừa bị lưu trữ (giá trị vẫn hợp lệ, không hiện ô trống).
 */
export function projectOptionsFor(
  projects: readonly { id: string; name: string; key: string; isArchived: boolean }[] | undefined,
  currentProjectId: string,
): SearchSelectOption[] {
  return (projects ?? [])
    .filter((p) => !p.isArchived || p.id === currentProjectId)
    .map((p) => ({ value: p.id, label: p.name, hint: p.key }));
}

/**
 * Nhóm mời chọn: nhóm người sửa thuộc (trưởng nhóm hoặc thành viên); admin: mọi nhóm. Nhóm đang gắn luôn hiện kể cả khi
 * người sửa không còn thuộc nhóm (giữ nguyên, không bị chặn).
 */
export function teamOptionsFor(
  teams:
    | readonly {
        id: string;
        name: string;
        lead?: { id: string } | null;
        members: readonly { id: string }[];
      }[]
    | undefined,
  viewer: { userId: string | undefined; isAdmin: boolean },
  currentTeamId: string,
): SearchSelectOption[] {
  const all = teams ?? [];
  const mine = all.filter(
    (t) =>
      viewer.isAdmin ||
      t.lead?.id === viewer.userId ||
      t.members.some((m) => m.id === viewer.userId),
  );
  const current = all.find((t) => t.id === currentTeamId);
  const list = current && !mine.includes(current) ? [...mine, current] : mine;
  return list.map((t) => ({ value: t.id, label: t.name }));
}
