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
  workspaceId: string | null;
  name: string;
  scope: RoleScope;
  isSystem: boolean;
  description: string | null;
  color: string | null;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
  _count: { wsMembershipRoles: number; projMembershipRoles: number };
};

/** Đếm số lần gán vai trò — chỉ trong workspace đang xem (không đếm toàn hệ thống). */
const memberCountSelect = (workspaceId: string) =>
  ({
    wsMembershipRoles: { where: { membership: { workspaceId } } },
    projMembershipRoles: { where: { membership: { project: { workspaceId, deletedAt: null } } } },
  }) as const;

const roleSelect = (workspaceId: string) =>
  ({
    id: true,
    workspaceId: true,
    name: true,
    scope: true,
    isSystem: true,
    description: true,
    color: true,
    updatedAt: true,
    permissions: { select: { permission: { select: { key: true } } } },
    _count: { select: memberCountSelect(workspaceId) },
  }) as const;

/**
 * Danh mục vai trò: gồm role HỆ THỐNG (workspaceId=null, dùng chung, chỉ đọc) + role
 * CUSTOM của workspace (sửa/xoá được). Quyền sửa/xoá gated bởi MEMBER_MANAGE ở controller.
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

  async list(workspaceId: string, scope?: RoleScope) {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }], ...(scope ? { scope } : {}) },
      orderBy: [{ isSystem: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
      select: roleSelect(workspaceId),
    });
    return roles.map((r) => this.toDto(r));
  }

  async create(workspaceId: string, input: CreateRoleInput, actorId: string) {
    // P-C14: vai trò (kể cả bản nhân bản) mang workspace:admin chỉ quản trị mới tạo được.
    if (input.permissionKeys.includes(PERMISSIONS.WORKSPACE_ADMIN))
      await this.assertCallerHoldsAdmin(workspaceId, actorId);
    const permIds = await this.permIds(input.permissionKeys);
    const role = await this.prisma.role.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        scope: input.scope,
        isSystem: false,
        description: input.description ?? null,
        color: input.color ?? null,
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
      select: roleSelect(workspaceId),
    });
    await this.audit.record({
      workspaceId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'role',
      entityId: role.id,
      summary: `Tạo vai trò "${role.name}"`,
      meta: { name: role.name, scope: role.scope, permissionCount: permIds.length },
    });
    return this.toDto(role);
  }

  async update(workspaceId: string, id: string, input: UpdateRoleInput, actorId: string) {
    await this.assertCustom(workspaceId, id);
    await this.assertMayEditAdminRole(workspaceId, id, input.permissionKeys, actorId);
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
      permIds !== null && !(input.permissionKeys ?? []).includes(PERMISSIONS.WORKSPACE_ADMIN);
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
          where: { roleId: id, permission: { key: PERMISSIONS.WORKSPACE_ADMIN } },
        })) > 0;
      if (permIds) await tx.rolePermission.deleteMany({ where: { roleId: id } });
      const updated = await tx.role.update({
        where: { id },
        data,
        select: roleSelect(workspaceId),
      });
      if (hadAdmin) await this.assertWorkspaceStillHasAdmin(tx, workspaceId);
      return updated;
    });
    await this.rbac.invalidateWorkspace(workspaceId); // quyền role đổi → xoá cache toàn workspace
    // Bộ quyền đổi → ảnh hưởng mọi người giữ vai trò này: gateway rà lại socket cả workspace (rút người mất quyền xem).
    if (input.permissionKeys) this.events?.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { workspaceId });
    await this.audit.record({
      workspaceId,
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

  async remove(workspaceId: string, id: string, actorId: string) {
    const role = await this.assertCustom(workspaceId, id);
    const count = role._count.wsMembershipRoles + role._count.projMembershipRoles;
    if (count > 0) {
      throw new ForbiddenAppException(
        `Vai trò đang gán cho ${count} thành viên — gỡ khỏi họ trước khi xoá`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
    await this.rbac.invalidateWorkspace(workspaceId);
    await this.audit.record({
      workspaceId,
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
  /** P-C14: người gọi phải đang giữ `workspace:admin` (hoặc là admin hệ thống) — `member:manage` một mình không đủ. */
  private async assertCallerHoldsAdmin(workspaceId: string, actorId: string): Promise<void> {
    if (!(await this.rbac.holdsWorkspaceAdmin(actorId, workspaceId)))
      throw new AdminGrantRequiresAdminException();
  }

  /**
   * P-C14: sửa vai trò cần quản trị khi bộ quyền MỚI có `workspace:admin` (thêm) hoặc vai trò ĐANG có nó (gỡ, hoặc sửa
   * quyền khác/tên/mô tả — đổi quyền của mọi quản trị đang giữ vai trò này). Sửa vai trò không dính quản trị thì không đổi.
   */
  private async assertMayEditAdminRole(
    workspaceId: string,
    roleId: string,
    newKeys: string[] | undefined,
    actorId: string,
  ): Promise<void> {
    if (await this.rbac.holdsWorkspaceAdmin(actorId, workspaceId)) return;
    const addsAdmin = newKeys?.includes(PERMISSIONS.WORKSPACE_ADMIN) ?? false;
    const hasAdmin =
      addsAdmin ||
      (await this.prisma.rolePermission.count({
        where: { roleId, permission: { key: PERMISSIONS.WORKSPACE_ADMIN } },
      })) > 0;
    if (hasAdmin) throw new AdminGrantRequiresAdminException();
  }

  /**
   * Phản chiếu `MembersService.assertNotLastWorkspaceAdmin` cho đường SỬA VAI TRÒ: gỡ `workspace:admin` khỏi một vai trò
   * không được làm workspace hết quản trị viên (còn hoạt động) — sau đó chỉ admin hệ thống mới khôi phục được.
   */
  private async assertWorkspaceStillHasAdmin(
    tx: Pick<PrismaService, 'workspaceMembership'>,
    workspaceId: string,
  ): Promise<void> {
    const admins = await tx.workspaceMembership.count({
      where: {
        workspaceId,
        user: { status: { not: 'DEACTIVATED' } },
        roles: {
          some: {
            role: { permissions: { some: { permission: { key: PERMISSIONS.WORKSPACE_ADMIN } } } },
          },
        },
      },
    });
    if (admins > 0) return;
    throw new ConflictAppException(
      ERROR_CODES.LAST_WORKSPACE_ADMIN,
      'Gỡ quyền này sẽ khiến không gian làm việc không còn quản trị viên — hãy cấp quyền quản trị cho vai trò khác trước',
    );
  }

  private toDto(r: RoleRow) {
    const meta = SYSTEM_ROLE_META[r.name as keyof typeof SYSTEM_ROLE_META];
    return {
      id: r.id,
      workspaceId: r.workspaceId,
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

  private async assertCustom(workspaceId: string, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isSystem: true,
        workspaceId: true,
        _count: { select: memberCountSelect(workspaceId) },
      },
    });
    if (!role) throw new NotFoundAppException('Vai trò');
    if (role.isSystem || role.workspaceId !== workspaceId) {
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
