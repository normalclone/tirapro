import { DASHBOARD_SCOPES, type DashboardScopeValue } from '@tirapro/shared';
import type { SearchSelectOption } from '@/components/ui/SearchSelect';

/** Mức chia sẻ của bảng tổng quan (4 mức). Bộ lọc đã lưu có hộp chia sẻ riêng (nhiều dự án + người cụ thể). */
export type ShareKind = DashboardScopeValue;

export interface ShareValue {
  scope: ShareKind;
  projectId: string;
  teamId: string;
}

export const DASHBOARD_SHARE_KINDS: readonly ShareKind[] = DASHBOARD_SCOPES;

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
