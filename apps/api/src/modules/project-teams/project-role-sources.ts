import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * NGUỒN của vai trò dự án (team theo dự án).
 *
 * `ProjectMembershipRole` giữ MỖI (thành viên, vai trò) đúng một dòng — mọi nơi đọc quyền vẫn đọc như cũ. Nguồn của dòng đó:
 *  - `direct = true`: gán trực tiếp (mọi dòng có trước tính năng này mặc định là direct);
 *  - các dòng `ProjectMembershipRoleTeam`: vai trò nhờ team được gắn vào dự án (mỗi team một dòng).
 * Một người có cùng vai trò từ nhiều nguồn thì giữ cả các nguồn; dòng vai trò chỉ bị xoá khi KHÔNG còn nguồn nào, và tư cách thành viên
 * dự án bị xoá khi không còn vai trò nào.
 *
 * `ProjectMembership.roleId` (vai trò chính, trường cũ) luôn được giữ NHẤT QUÁN với tập vai trò hiện có (`ensurePrimary`): còn nằm trong
 * tập thì giữ nguyên; không thì lấy vai trò đầu tiên còn lại theo thứ tự (gán trực tiếp trước, rồi theo roleId) — xác định, không phụ thuộc
 * thứ tự chèn.
 *
 * Mọi hàm chạy trong transaction của bên gọi và PHẢI được gọi sau `lockProjectRoles(tx, projectId)` để hai thay đổi đồng thời trên cùng
 * dự án xếp hàng (đọc-rồi-ghi không chồng lên nhau).
 */

/** Khoá tư vấn theo dự án: xếp hàng mọi thay đổi vai trò/nguồn của một dự án. Khoá nhiều dự án thì theo thứ tự projectId tăng dần; luôn lấy SAU `lockTeamRoles` (nếu có). */
export async function lockProjectRoles(tx: Tx, projectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-roles:${projectId}`}))`;
}

/**
 * Khoá tư vấn theo team: xếp hàng mọi thay đổi LIÊN KẾT hoặc THÀNH VIÊN của một team. Bắt buộc lấy TRƯỚC khi sửa `TeamMember` và TRƯỚC
 * khoá dự án (thứ tự cố định team → dự án, tránh kẹt vòng). Thiếu khoá này, "gắn team" đọc danh sách người cũ trong khi "đổi người"
 * chưa thấy liên kết mới → cả hai commit nhưng người mới vào team không nhận vai trò.
 */
export async function lockTeamRoles(tx: Tx, teamId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-roles:${teamId}`}))`;
}

interface MembershipRef {
  id: string;
  roleId: string;
}

/**
 * Thành viên cũ có thể chưa có dòng nối nào (chỉ có vai trò chính): ghi vai trò chính thành một dòng `direct` trước khi đụng tới nguồn,
 * để vai trò chính không biến mất khi ta thêm/bớt vai trò khác.
 */
async function materializePrimary(tx: Tx, m: MembershipRef): Promise<void> {
  const any = await tx.projectMembershipRole.findFirst({
    where: { membershipId: m.id },
    select: { roleId: true },
  });
  if (!any)
    await tx.projectMembershipRole.createMany({
      data: [{ membershipId: m.id, roleId: m.roleId, direct: true }],
      skipDuplicates: true,
    });
}

/** Giữ `ProjectMembership.roleId` thuộc tập vai trò hiện có; trả `false` nếu không còn vai trò nào (bên gọi xoá thành viên). */
async function ensurePrimary(tx: Tx, m: MembershipRef, preferred?: string): Promise<boolean> {
  const rows = await tx.projectMembershipRole.findMany({
    where: { membershipId: m.id },
    select: { roleId: true, direct: true },
  });
  if (rows.length === 0) return false;
  const ids = new Set(rows.map((r) => r.roleId));
  const want =
    preferred && ids.has(preferred)
      ? preferred
      : ids.has(m.roleId)
        ? m.roleId
        : [...rows].sort(
            (a, b) => Number(b.direct) - Number(a.direct) || a.roleId.localeCompare(b.roleId),
          )[0]!.roleId;
  if (want !== m.roleId)
    await tx.projectMembership.update({ where: { id: m.id }, data: { roleId: want } });
  return true;
}

export interface ReconcileResult {
  /** Có thay đổi vai trò/nguồn nào không. */
  changed: boolean;
  /** Tư cách thành viên dự án vừa được TẠO bởi team. */
  created: boolean;
  /** Tư cách thành viên dự án bị xoá vì hết vai trò. */
  removed: boolean;
  /** Không gỡ được vì là thành viên cuối của dự án riêng tư (giữ nguyên vai trò nhờ team). */
  keptLastOfPrivate: boolean;
}

const NOOP: ReconcileResult = {
  changed: false,
  created: false,
  removed: false,
  keptLastOfPrivate: false,
};

/**
 * ĐẶT các vai trò nhờ team `teamId` của người dùng ở dự án đúng bằng `desiredRoleIds` (rỗng = gỡ phần nhờ team). Idempotent, chỉ tính
 * theo trạng thái hiện có nên chạy lại / chạy đồng thời đều cho cùng kết quả. KHÔNG bao giờ đụng vai trò `direct`.
 * `privateProject`: dự án riêng tư — không xoá thành viên cuối cùng của nó (xem `keptLastOfPrivate`).
 */
export async function reconcileTeamRoles(
  tx: Tx,
  a: {
    projectId: string;
    userId: string;
    teamId: string;
    desiredRoleIds: string[];
    privateProject: boolean;
  },
): Promise<ReconcileResult> {
  const desired = [...new Set(a.desiredRoleIds)];
  let m = await tx.projectMembership.findUnique({
    where: { projectId_userId: { projectId: a.projectId, userId: a.userId } },
    select: { id: true, roleId: true },
  });
  let created = false;
  if (!m) {
    if (desired.length === 0) return NOOP;
    m = await tx.projectMembership.create({
      data: { projectId: a.projectId, userId: a.userId, roleId: desired[0]! },
      select: { id: true, roleId: true },
    });
    created = true;
  }

  const current = await tx.projectMembershipRoleTeam.findMany({
    where: { membershipId: m.id, teamId: a.teamId },
    select: { roleId: true },
  });
  const have = new Set(current.map((c) => c.roleId));
  const want = new Set(desired);
  const toAdd = desired.filter((r) => !have.has(r));
  const toRemove = [...have].filter((r) => !want.has(r));
  if (toAdd.length === 0 && toRemove.length === 0 && !created) return NOOP;

  // Gỡ cuối cùng của dự án riêng tư: không để dự án mồ côi — giữ lại vai trò nhờ team của người này.
  if (toRemove.length > 0 && toAdd.length === 0 && a.privateProject) {
    const left = await countRolesAfterRemoval(tx, m.id, toRemove, a.teamId);
    if (left === 0) {
      const members = await tx.projectMembership.count({ where: { projectId: a.projectId } });
      if (members <= 1) return { ...NOOP, keptLastOfPrivate: true };
    }
  }

  if (!created) await materializePrimary(tx, m); // chỉ khi thật sự đổi — lần chạy không đổi gì thì không ghi
  if (toAdd.length > 0) {
    await tx.projectMembershipRole.createMany({
      data: toAdd.map((roleId) => ({ membershipId: m.id, roleId, direct: false })),
      skipDuplicates: true,
    });
    await tx.projectMembershipRoleTeam.createMany({
      data: toAdd.map((roleId) => ({ membershipId: m.id, roleId, teamId: a.teamId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await tx.projectMembershipRoleTeam.deleteMany({
      where: { membershipId: m.id, teamId: a.teamId, roleId: { in: toRemove } },
    });
    await dropOrphanRoles(tx, m.id, toRemove);
  }

  const alive = await ensurePrimary(tx, m);
  if (!alive) {
    await tx.projectMembership.delete({ where: { id: m.id } });
    return { changed: true, created: false, removed: true, keptLastOfPrivate: false };
  }
  return { changed: true, created, removed: false, keptLastOfPrivate: false };
}

/** Số vai trò còn lại của thành viên nếu bỏ phần nhờ team `teamId` ở `roleIds` (vai trò direct hoặc còn nguồn team khác thì ở lại). */
async function countRolesAfterRemoval(
  tx: Tx,
  membershipId: string,
  roleIds: string[],
  teamId: string,
): Promise<number> {
  const rows = await tx.projectMembershipRole.findMany({
    where: { membershipId },
    select: {
      roleId: true,
      direct: true,
      teamSources: { select: { teamId: true, roleId: true } },
    },
  });
  const removing = new Set(roleIds);
  return rows.filter(
    (r) => r.direct || r.teamSources.some((s) => !(s.teamId === teamId && removing.has(s.roleId))),
  ).length;
}

/** Xoá các dòng vai trò đã hết nguồn (không direct và không còn dòng nguồn team nào). */
async function dropOrphanRoles(tx: Tx, membershipId: string, roleIds: string[]): Promise<void> {
  await tx.projectMembershipRole.deleteMany({
    where: { membershipId, roleId: { in: roleIds }, direct: false, teamSources: { none: {} } },
  });
}

/**
 * ĐẶT các vai trò GÁN TRỰC TIẾP của thành viên đúng bằng `roleIds` (không rỗng; `roleIds[0]` là vai trò chính). Vai trò bị bỏ mà còn nguồn
 * team thì ở lại (chỉ mất cờ direct); vai trò nhờ team KHÔNG bị đụng.
 */
export async function setDirectRoles(
  tx: Tx,
  membership: MembershipRef,
  roleIds: string[],
): Promise<void> {
  await materializePrimary(tx, membership);
  const rows = await tx.projectMembershipRole.findMany({
    where: { membershipId: membership.id },
    select: { roleId: true },
  });
  const want = new Set(roleIds);
  const drop = rows.map((r) => r.roleId).filter((r) => !want.has(r));
  if (drop.length > 0) {
    await tx.projectMembershipRole.updateMany({
      where: { membershipId: membership.id, roleId: { in: drop } },
      data: { direct: false },
    });
    await dropOrphanRoles(tx, membership.id, drop);
  }
  await tx.projectMembershipRole.updateMany({
    where: { membershipId: membership.id, roleId: { in: roleIds } },
    data: { direct: true },
  });
  await tx.projectMembershipRole.createMany({
    data: roleIds.map((roleId) => ({ membershipId: membership.id, roleId, direct: true })),
    skipDuplicates: true,
  });
  await tx.projectMembership.update({
    where: { id: membership.id },
    data: { roleId: roleIds[0]! },
  });
}

/**
 * GỠ phần gán trực tiếp ("xoá vai trò riêng"): vai trò còn nguồn team ở lại, còn lại bị xoá. Trả `true` nếu tư cách thành viên cũng bị
 * xoá (không còn vai trò nào) — người này quay về vai trò mặc định suy từ tổ chức.
 */
export async function clearDirectRoles(tx: Tx, membership: MembershipRef): Promise<boolean> {
  await materializePrimary(tx, membership);
  await tx.projectMembershipRole.updateMany({
    where: { membershipId: membership.id },
    data: { direct: false },
  });
  await tx.projectMembershipRole.deleteMany({
    where: { membershipId: membership.id, direct: false, teamSources: { none: {} } },
  });
  const alive = await ensurePrimary(tx, membership);
  if (!alive) {
    await tx.projectMembership.delete({ where: { id: membership.id } });
    return true;
  }
  return false;
}

/** Sau khi gỡ phần trực tiếp: thành viên có còn vai trò nhờ team không (để báo "vẫn ở dự án nhờ team khác"). */
export async function teamNamesOf(
  tx: Tx,
  membershipId: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await tx.projectMembershipRoleTeam.findMany({
    where: { membershipId },
    select: { team: { select: { id: true, name: true } } },
    distinct: ['teamId'],
  });
  return rows.map((r) => r.team);
}
