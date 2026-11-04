import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Giữ bất biến "thành viên team riêng ⊆ thành viên dự án" khi người rời dự án. Thành viên dự án: dự án công khai = mọi thành viên
 * tổ chức; dự án riêng tư = chỉ các dòng `ProjectMembership`. Chạy TRONG transaction làm mất tư cách đó.
 */

/**
 * Một dòng `ProjectMembership` của người này bị xoá: nếu dự án RIÊNG TƯ thì họ không còn là thành viên → ra khỏi mọi team riêng của dự án.
 * Dự án công khai: họ vẫn là thành viên (mặc định theo tổ chức) nên giữ nguyên.
 */
export async function pruneSubTeamsOnMembershipRemoved(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<void> {
  await tx.projectSubTeamMember.deleteMany({
    where: { userId, subTeam: { projectId, project: { isPrivate: true } } },
  });
}

/** Người rời tổ chức: ra khỏi mọi team riêng của mọi dự án trong tổ chức đó. */
export async function pruneSubTeamsOnOrganizationRemoved(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<void> {
  await tx.projectSubTeamMember.deleteMany({
    where: { userId, subTeam: { project: { organizationId } } },
  });
}

/** Dự án vừa chuyển sang riêng tư: ai không có `ProjectMembership` không còn là thành viên → ra khỏi team riêng của dự án. */
export async function pruneSubTeamsForPrivateProject(tx: Tx, projectId: string): Promise<void> {
  await tx.projectSubTeamMember.deleteMany({
    where: {
      subTeam: { projectId },
      user: { projectMemberships: { none: { projectId } } },
    },
  });
}

/** Khoá tư vấn theo dự án cho thay đổi team riêng (tên duy nhất không phân biệt hoa/thường, đổi người đồng thời). */
export async function lockProjectSubTeams(tx: Tx, projectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-subteams:${projectId}`}))`;
}
