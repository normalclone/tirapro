import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AUDIT_ACTIONS,
  DOMAIN_EVENTS,
  ERROR_CODES,
  PERMISSIONS,
  PERMISSION_CATALOG,
  SYSTEM_ROLE_META,
  type RoleScope,
} from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  AdminGrantRequiresAdminException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  VersionConflictException,
} from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schemas';

const VALID_KEYS = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));

type RoleRow = {
  id: string;
  organizationId: string | null;
  name: string;
  scope: RoleScope;
  isSystem: boolean;
  description: string | null;
  color: string | null;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
  _count: { wsMembershipRoles: number; projMembershipRoles: number };
};

/** Đếm số lần gán vai trò — chỉ trong tổ chức đang xem (không đếm toàn hệ thống). */
const memberCountSelect = (organizationId: string) =>
  ({
    wsMembershipRoles: { where: { membership: { organizationId } } },
    projMembershipRoles: {
      where: { membership: { project: { organizationId, deletedAt: null } } },
    },
  }) as const;

const roleSelect = (organizationId: string) =>
  ({
    id: true,
    organizationId: true,
    name: true,
    scope: true,
    isSystem: true,
    description: true,
    color: true,
    updatedAt: true,
    permissions: { select: { permission: { select: { key: true } } } },
    _count: { select: memberCountSelect(organizationId) },
  }) as const;

/**
 * Danh mục vai trò: gồm role HỆ THỐNG (organizationId=null, dùng chung, chỉ đọc) + role
 * CUSTOM của tổ chức (sửa/xoá được) = các MẪU vai trò. Chỉ Quản trị (`organization:admin`) tạo/sửa/xoá mẫu (controller).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    // Tuỳ chọn để chỗ dựng service bằng 3 đối số (spec cũ) vẫn chạy; Nest DI tiêm bản thật.
    private readonly events?: EventEmitter2,
  ) {}

  async list(organizationId: string, scope?: RoleScope) {
    const roles = await this.prisma.role.findMany({
      // Chỉ MẪU dùng chung (hệ thống + tuỳ chỉnh của tổ chức); vai trò riêng của từng dự án không hiện ở đây.
      where: {
        projectId: null,
        OR: [{ organizationId: null }, { organizationId }],
        ...(scope ? { scope } : {}),
      },
      orderBy: [{ isSystem: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
      select: roleSelect(organizationId),
    });
    return roles.map((r) => this.toDto(r));
  }

  async create(organizationId: string, input: CreateRoleInput, actorId: string) {
    // P-C14: vai trò (kể cả bản nhân bản) mang organization:admin chỉ quản trị mới tạo được.
    if (input.permissionKeys.includes(PERMISSIONS.ORGANIZATION_ADMIN))
      await this.assertCallerHoldsAdmin(organizationId, actorId);
    const permIds = await this.permIds(input.permissionKeys);
    const role = await this.prisma.role.create({
      data: {
        organizationId,
        name: input.name.trim(),
        scope: input.scope,
        isSystem: false,
        description: input.description ?? null,
        color: input.color ?? null,
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
      select: roleSelect(organizationId),
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'role',
      entityId: role.id,
      summary: `Tạo vai trò "${role.name}"`,
      meta: { name: role.name, scope: role.scope, permissionCount: permIds.length },
    });
    return this.toDto(role);
  }

  async update(organizationId: string, id: string, input: UpdateRoleInput, actorId: string) {
    await this.assertCustom(organizationId, id);
    await this.assertMayEditAdminRole(organizationId, id, input.permissionKeys, actorId);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    let permIds: string[] | null = null;
    if (input.permissionKeys) {
      permIds = await this.permIds(input.permissionKeys);
      data.permissions = { create: permIds.map((permissionId) => ({ permissionId })) };
    }
    // Prisma không tự đóng dấu `updatedAt` khi lệnh chỉ ghi quan hệ lồng → đóng tay: dấu này là "phiên bản" của vai trò.
    const now = new Date();
    data.updatedAt = now;
    const removesAdmin =
      permIds !== null && !(input.permissionKeys ?? []).includes(PERMISSIONS.ORGANIZATION_ADMIN);
    // MỘT transaction cho cả: (1) so-sánh-và-đặt `updatedAt` (điều kiện tiên quyết của client), (2) xoá bộ quyền cũ + ghi
    // vai trò kèm bộ mới (đổi tên trùng/lỗi giữa chừng không làm vai trò mất sạch quyền), (3) chặn gỡ quản trị cuối cùng.
    const role = await this.prisma.$transaction(async (tx) => {
      if (input.expectedUpdatedAt) {
        // `updateMany` có điều kiện là phép CAS nguyên tử: hai PATCH đồng thời cùng bản cũ → người sau chờ khoá hàng rồi
        // thấy `updatedAt` đã đổi → 0 hàng → 409 (không ghi đè lặng lẽ).
        const hit = await tx.role.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: { updatedAt: now },
        });
        if (hit.count === 0) {
          throw new VersionConflictException('Vai trò vừa được người khác sửa — hãy tải lại');
        }
      }
      const hadAdmin =
        removesAdmin &&
        (await tx.rolePermission.count({
          where: { roleId: id, permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } },
        })) > 0;
      if (permIds) await tx.rolePermission.deleteMany({ where: { roleId: id } });
      const updated = await tx.role.update({
        where: { id },
        data,
        select: roleSelect(organizationId),
      });
      if (hadAdmin) await this.assertOrganizationStillHasAdmin(tx, organizationId);
      return updated;
    });
    await this.rbac.invalidateOrganization(organizationId); // quyền role đổi → xoá cache toàn tổ chức
    // Bộ quyền đổi → ảnh hưởng mọi người giữ vai trò này: gateway rà lại socket cả tổ chức (rút người mất quyền xem).
    if (input.permissionKeys) this.events?.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { organizationId });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      entityType: 'role',
      entityId: role.id,
      summary: `Sửa vai trò "${role.name}"`,
      meta: {
        name: role.name,
        changed: Object.keys(input).filter(
          (k) => k !== 'expectedUpdatedAt' && input[k as keyof UpdateRoleInput] !== undefined,
        ),
        permissionCount: role.permissions.length,
      },
    });
    return this.toDto(role);
  }

  async remove(organizationId: string, id: string, actorId: string) {
    const role = await this.assertCustom(organizationId, id);
    const count = role._count.wsMembershipRoles + role._count.projMembershipRoles;
    if (count > 0) {
      throw new ForbiddenAppException(
        `Vai trò đang gán cho ${count} thành viên — gỡ khỏi họ trước khi xoá`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.rbac.invalidateOrganization(organizationId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_DELETED,
      entityType: 'role',
      entityId: id,
      summary: `Xoá vai trò "${role.name}"`,
      meta: { name: role.name },
    });
    return { success: true };
  }

  // ── helpers ──
  /** P-C14: người gọi phải đang giữ `organization:admin` (hoặc là admin hệ thống) — `member:manage` một mình không đủ. */
  private async assertCallerHoldsAdmin(organizationId: string, actorId: string): Promise<void> {
    if (!(await this.rbac.holdsOrganizationAdmin(actorId, organizationId)))
      throw new AdminGrantRequiresAdminException();
  }

  /**
   * P-C14: sửa vai trò cần quản trị khi bộ quyền MỚI có `organization:admin` (thêm) hoặc vai trò ĐANG có nó (gỡ, hoặc sửa
   * quyền khác/tên/mô tả — đổi quyền của mọi quản trị đang giữ vai trò này). Sửa vai trò không dính quản trị thì không đổi.
   */
  private async assertMayEditAdminRole(
    organizationId: string,
    roleId: string,
    newKeys: string[] | undefined,
    actorId: string,
  ): Promise<void> {
    if (await this.rbac.holdsOrganizationAdmin(actorId, organizationId)) return;
    const addsAdmin = newKeys?.includes(PERMISSIONS.ORGANIZATION_ADMIN) ?? false;
    const hasAdmin =
      addsAdmin ||
      (await this.prisma.rolePermission.count({
        where: { roleId, permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } },
      })) > 0;
    if (hasAdmin) throw new AdminGrantRequiresAdminException();
  }

  /**
   * Phản chiếu `MembersService.assertNotLastOrganizationAdmin` cho đường SỬA VAI TRÒ: gỡ `organization:admin` khỏi một vai trò
   * không được làm tổ chức hết quản trị viên (còn hoạt động) — sau đó chỉ admin hệ thống mới khôi phục được.
   */
  private async assertOrganizationStillHasAdmin(
    tx: Pick<PrismaService, 'organizationMembership'>,
    organizationId: string,
  ): Promise<void> {
    const admins = await tx.organizationMembership.count({
      where: {
        organizationId,
        user: { status: { not: 'DEACTIVATED' } },
        roles: {
          some: {
            role: {
              permissions: { some: { permission: { key: PERMISSIONS.ORGANIZATION_ADMIN } } },
            },
          },
        },
      },
    });
    if (admins > 0) return;
    throw new ConflictAppException(
      ERROR_CODES.LAST_ORGANIZATION_ADMIN,
      'Gỡ quyền này sẽ khiến tổ chức không còn quản trị viên — hãy cấp quyền quản trị cho vai trò khác trước',
    );
  }

  private toDto(r: RoleRow) {
    const meta = SYSTEM_ROLE_META[r.name as keyof typeof SYSTEM_ROLE_META];
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      scope: r.scope,
      isSystem: r.isSystem,
      description: r.description ?? (r.isSystem ? (meta?.description ?? null) : null),
      color: r.color ?? (r.isSystem ? (meta?.color ?? null) : null),
      permissionKeys: r.permissions.map((p) => p.permission.key),
      memberCount: r._count.wsMembershipRoles + r._count.projMembershipRoles,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async assertCustom(organizationId: string, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isSystem: true,
        organizationId: true,
        projectId: true,
        _count: { select: memberCountSelect(organizationId) },
      },
    });
    // Vai trò riêng của dự án đi qua `/projects/:id/roles` (Project Admin), không qua danh mục mẫu → 404 như không tồn tại.
    if (!role || role.projectId) throw new NotFoundAppException('Vai trò');
    if (role.isSystem || role.organizationId !== organizationId) {
      throw new ForbiddenAppException('Không thể sửa/xoá vai trò hệ thống');
    }
    return role;
  }

  private async permIds(keys: string[]): Promise<string[]> {
    const valid = [...new Set(keys)].filter((k) => VALID_KEYS.has(k));
    if (!valid.length) return [];
    const rows = await this.prisma.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
