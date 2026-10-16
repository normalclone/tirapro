import type { Prisma } from '@prisma/client';

/** Người xem đã được phân giải: `isAdmin` = admin hệ thống hoặc `workspace:admin` (xem `ProjectAccessService.seesAll`). */
export interface DashboardViewer {
  userId: string;
  isAdmin: boolean;
}

/**
 * MỘT hàm duy nhất quyết định người xem THẤY dashboard nào (list/get/duplicate/update/delete đều đi qua đây).
 * Thấy = chưa xoá, cùng workspace VÀ một trong:
 * - của tôi (mọi mức — chủ vẫn thấy bản của mình để chuyển mức/xoá dù đã mất quyền xem dự án/nhóm);
 * - GLOBAL: mọi thành viên workspace;
 * - PROJECT: dự án còn sống và người xem thấy được (`projectVisible` = `ProjectAccessService.visibleWhere` — dự án riêng
 *   tư chỉ thành viên/admin; đánh giá lúc đọc nên khi dự án thành riêng tư hoặc người xem bị gỡ, dashboard tự biến mất);
 * - TEAM: nhóm còn sống mà người xem là trưởng nhóm hoặc thành viên.
 * Admin thấy mọi GLOBAL/PROJECT/TEAM còn sống; KHÔNG thấy PRIVATE của người khác.
 */
export function dashboardVisibleWhere(
  viewer: DashboardViewer,
  workspaceId: string,
  projectVisible: Prisma.ProjectWhereInput,
): Prisma.DashboardWhereInput {
  const { userId, isAdmin } = viewer;
  const teamCondition: Prisma.TeamWhereInput = isAdmin
    ? { deletedAt: null }
    : { deletedAt: null, OR: [{ leadId: userId }, { members: { some: { userId } } }] };
  return {
    workspaceId,
    deletedAt: null,
    OR: [
      { ownerId: userId },
      { scope: 'GLOBAL' },
      { scope: 'PROJECT', project: { deletedAt: null, ...projectVisible } },
      { scope: 'TEAM', team: teamCondition },
    ],
  };
}

/**
 * SỬA nội dung và ĐỔI mức chia sẻ: CHỈ chủ. Admin workspace, `project:admin`, trưởng nhóm không sửa dashboard của người
 * khác (họ muốn chỉnh thì nhân bản) — nên người khác không thể công bố bản của chủ ra cả workspace hay ẩn nó khỏi
 * chính những người đang dùng.
 */
export function canEditDashboard(viewer: DashboardViewer, dashboard: { ownerId: string }): boolean {
  return dashboard.ownerId === viewer.userId;
}

/**
 * XOÁ: chủ; hoặc admin workspace với dashboard đã chia sẻ (GLOBAL/PROJECT/TEAM) — để kiểm duyệt. Admin không bao giờ
 * xoá được PRIVATE của người khác (cũng không thấy được).
 */
export function canDeleteDashboard(
  viewer: DashboardViewer,
  dashboard: { ownerId: string; scope: 'PRIVATE' | 'GLOBAL' | 'PROJECT' | 'TEAM' },
): boolean {
  if (dashboard.ownerId === viewer.userId) return true;
  return viewer.isAdmin && dashboard.scope !== 'PRIVATE';
}

const SCOPE_RANK = { PRIVATE: 0, GLOBAL: 1, PROJECT: 2, TEAM: 3 } as const;

/** Của tôi trước (riêng tư rồi các mức khác), rồi của người khác theo mức GLOBAL → PROJECT → TEAM, rồi theo tên. */
export function sortDashboards<
  T extends { scope: keyof typeof SCOPE_RANK; isMine: boolean; name: string },
>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      Number(b.isMine) - Number(a.isMine) ||
      SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
      a.name.localeCompare(b.name, 'vi'),
  );
}
