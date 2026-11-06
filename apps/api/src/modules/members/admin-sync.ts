import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PERMISSIONS, SYSTEM_ROLES } from '@tirapro/types';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';

/**
 * MỘT vai trò "Quản trị" = Quản trị tổ chức + Quản trị hệ thống. Cơ chế kiểm quyền không đổi (`isSystemAdmin` cho khu /admin,
 * `organization:admin` cho route tổ chức); thay vào đó HAI cờ được đồng bộ ở đây — nơi DUY NHẤT sửa `User.isSystemAdmin` khi vai
 * trò tổ chức đổi, và nơi duy nhất đổi cả hai cờ khi bật/tắt "Quản trị" ở Quản trị › Tài khoản. Mọi hàm chạy TRONG transaction của
 * bên gọi (hai thay đổi cùng commit). "Quản trị tổ chức" = giữ vai trò có quyền `organization:admin` (cùng định nghĩa với
 * `MembersService`/`RbacService`, nên vai trò tuỳ chỉnh mang quyền đó cũng tính).
 */
type Tx = Prisma.TransactionClient;

const ADMIN_ROLE_WHERE = {
  permissions: { some: { permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } } },
} as const;

/** Bộ vai trò này có mang quyền quản trị tổ chức không? */
async function rolesGrantAdmin(db: Tx, roleIds: readonly string[]): Promise<boolean> {
  if (roleIds.length === 0) return false;
  return (await db.role.count({ where: { id: { in: [...roleIds] }, ...ADMIN_ROLE_WHERE } })) > 0;
}

/** Thông báo khi bỏ/khoá/gỡ người Quản trị cuối cùng (422). */
const LAST_ADMIN_MESSAGE =
  'Đây là người Quản trị cuối cùng — hãy cấp quyền Quản trị cho người khác trước';

/**
 * Chặn bỏ / khoá người Quản trị hoạt động CUỐI CÙNG. Khoá hàng admin đang hoạt động (`FOR UPDATE`) trong cùng transaction với
 * thao tác ghi → hai người bỏ quyền lẫn nhau đồng thời sẽ xếp hàng, người thứ hai thấy tập đã co lại.
 */
async function assertNotLastAdminImpl(tx: Tx, userId: string): Promise<void> {
  const admins = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE "isSystemAdmin" = true AND "status" = 'ACTIVE' ORDER BY "id" FOR UPDATE`;
  if (admins.some((a) => a.id === userId) && admins.length <= 1) {
    throw new BusinessRuleException(LAST_ADMIN_MESSAGE);
  }
}

/** Người này còn là quản trị tổ chức ở một tổ chức KHÁC `exceptOrganizationId` không? */
async function isAdminElsewhere(
  tx: Tx,
  userId: string,
  exceptOrganizationId: string,
): Promise<boolean> {
  return (
    (await tx.organizationMembership.count({
      where: {
        userId,
        organizationId: { not: exceptOrganizationId },
        roles: { some: { role: ADMIN_ROLE_WHERE } },
      },
    })) > 0
  );
}

/**
 * Sau khi vai trò tổ chức của `userId` ở `organizationId` đổi (`wasAdmin` → `isAdmin`: có quyền quản trị tổ chức trước/sau):
 * - thành Quản trị → `isSystemAdmin = true`;
 * - mất Quản trị → `isSystemAdmin = false` nếu không còn là Quản trị ở tổ chức nào khác (chặn nếu là người Quản trị cuối cùng).
 * Không đổi trạng thái (admin→admin, thường→thường) thì KHÔNG đụng cờ (một admin hệ thống chưa thuộc tổ chức nào giữ nguyên cờ).
 * Trả `true` nếu cờ `isSystemAdmin` đã đổi (bên gọi phát `ACCESS_CHANGED` sau commit).
 */
async function syncSystemAdminOnOrgRoles(
  tx: Tx,
  userId: string,
  organizationId: string,
  wasAdmin: boolean,
  isAdmin: boolean,
): Promise<boolean> {
  if (wasAdmin === isAdmin) return false;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
  if (!user) return false;
  if (isAdmin) {
    if (user.isSystemAdmin) return false;
    await tx.user.update({ where: { id: userId }, data: { isSystemAdmin: true } });
    return true;
  }
  if (!user.isSystemAdmin) return false;
  if (await isAdminElsewhere(tx, userId, organizationId)) return false;
  await assertNotLastAdminImpl(tx, userId);
  await tx.user.update({ where: { id: userId }, data: { isSystemAdmin: false } });
  return true;
}

/** Vai trò hệ thống của tổ chức (toàn cục, `organizationId = null`). */
async function systemOrgRole(tx: Tx, name: string): Promise<string> {
  const role = await tx.role.findFirst({
    where: { name, scope: 'ORGANIZATION', organizationId: null, isSystem: true },
    select: { id: true },
  });
  if (!role) throw new NotFoundAppException(`Vai trò ${name}`);
  return role.id;
}

export interface SetAdminResult {
  /** Tổ chức đã đổi vai trò (để xoá cache quyền) — rỗng nếu chỉ đặt cờ. */
  organizationIds: string[];
  /** Cờ `isSystemAdmin` có đổi không. */
  flagChanged: boolean;
}

/**
 * Bật/tắt "Quản trị" cho một tài khoản (Quản trị › Tài khoản): đặt `isSystemAdmin` VÀ vai trò tổ chức.
 * - Bật: thêm vai trò `Organization Admin` (làm vai trò chính, giữ các vai trò khác) ở mọi tổ chức người đó thuộc; chưa thuộc tổ
 *   chức nào thì thêm vào tổ chức hoạt động DUY NHẤT khi chỉ có đúng một (nhiều hơn: chỉ đặt cờ).
 * - Tắt: chặn nếu là Quản trị cuối cùng; ở mọi tổ chức người đó đang là Quản trị → bỏ vai trò quản trị, về `Organization Member`
 *   (giữ vai trò thường khác nếu có).
 */
async function setAdminImpl(tx: Tx, userId: string, enabled: boolean): Promise<SetAdminResult> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isSystemAdmin: true } });
  if (!user) throw new NotFoundAppException('Người dùng');
  const organizationIds: string[] = [];
  if (enabled) {
    const adminRole = await systemOrgRole(tx, SYSTEM_ROLES.ORGANIZATION_ADMIN);
    const memberships = await tx.organizationMembership.findMany({
      where: { userId },
      select: { id: true, organizationId: true, roles: { select: { roleId: true } } },
    });
    for (const m of memberships) {
      if (!m.roles.some((r) => r.roleId === adminRole)) {
        await tx.organizationMembershipRole.create({
          data: { membershipId: m.id, roleId: adminRole },
        });
      }
      await tx.organizationMembership.update({ where: { id: m.id }, data: { roleId: adminRole } });
      organizationIds.push(m.organizationId);
    }
    if (memberships.length === 0) {
      const orgs = await tx.organization.findMany({
        where: { deletedAt: null },
        select: { id: true },
        take: 2,
      });
      if (orgs.length === 1) {
        await tx.organizationMembership.create({
          data: {
            organizationId: orgs[0]!.id,
            userId,
            roleId: adminRole,
            joinedAt: new Date(),
            roles: { create: [{ roleId: adminRole }] },
          },
        });
        organizationIds.push(orgs[0]!.id);
      }
    }
    if (!user.isSystemAdmin)
      await tx.user.update({ where: { id: userId }, data: { isSystemAdmin: true } });
    return { organizationIds, flagChanged: !user.isSystemAdmin };
  }

  if (user.isSystemAdmin) await assertNotLastAdminImpl(tx, userId);
  const memberRole = await systemOrgRole(tx, SYSTEM_ROLES.ORGANIZATION_MEMBER);
  const memberships = await tx.organizationMembership.findMany({
    where: { userId, roles: { some: { role: ADMIN_ROLE_WHERE } } },
    select: {
      id: true,
      organizationId: true,
      roles: {
        select: {
          roleId: true,
          role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
        },
      },
    },
  });
  for (const m of memberships) {
    const keep = m.roles
      .filter(
        (r) => !r.role.permissions.some((p) => p.permission.key === PERMISSIONS.ORGANIZATION_ADMIN),
      )
      .map((r) => r.roleId);
    const next = keep.length > 0 ? keep : [memberRole];
    await tx.organizationMembershipRole.deleteMany({ where: { membershipId: m.id } });
    await tx.organizationMembershipRole.createMany({
      data: next.map((roleId) => ({ membershipId: m.id, roleId })),
    });
    await tx.organizationMembership.update({ where: { id: m.id }, data: { roleId: next[0]! } });
    organizationIds.push(m.organizationId);
  }
  if (user.isSystemAdmin)
    await tx.user.update({ where: { id: userId }, data: { isSystemAdmin: false } });
  return { organizationIds, flagChanged: user.isSystemAdmin };
}

/**
 * Đồng bộ hai cờ quản trị (xem đầu tệp). Là provider riêng để `MembersService`/`AdminService` gọi qua một cửa và test từng bên
 * thay được bằng bản giả; logic đọc/ghi nằm ở các hàm phía trên (chạy trên transaction của bên gọi).
 */
@Injectable()
export class AdminSyncService {
  /** Bộ vai trò này có mang quyền quản trị tổ chức không? */
  grantsAdmin(db: Tx, roleIds: readonly string[]): Promise<boolean> {
    return rolesGrantAdmin(db, roleIds);
  }

  /** Chặn bỏ / khoá người Quản trị cuối cùng (422). */
  assertNotLastAdmin(tx: Tx, userId: string): Promise<void> {
    return assertNotLastAdminImpl(tx, userId);
  }

  /** Vai trò tổ chức đổi (`wasAdmin` → `isAdmin`) → cờ `isSystemAdmin`; trả true nếu cờ đổi. */
  syncOnOrgRoles(
    tx: Tx,
    userId: string,
    organizationId: string,
    wasAdmin: boolean,
    isAdmin: boolean,
  ): Promise<boolean> {
    return syncSystemAdminOnOrgRoles(tx, userId, organizationId, wasAdmin, isAdmin);
  }

  /** Bật/tắt "Quản trị" ở Quản trị › Tài khoản: cờ + vai trò tổ chức. */
  setAdmin(tx: Tx, userId: string, enabled: boolean): Promise<SetAdminResult> {
    return setAdminImpl(tx, userId, enabled);
  }
}
