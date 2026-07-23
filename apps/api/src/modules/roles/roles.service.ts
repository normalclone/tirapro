import { Injectable } from '@nestjs/common';
import { PERMISSION_CATALOG, SYSTEM_ROLE_META, type RoleScope } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { RbacService } from '../rbac/rbac.service';
import type { CreateRoleInput, UpdateRoleInput } from './roles.schemas';

const VALID_KEYS = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));

type RoleRow = {
  id: string; workspaceId: string | null; name: string; scope: RoleScope; isSystem: boolean;
  description: string | null; color: string | null;
  permissions: { permission: { key: string } }[];
  _count: { wsMembershipRoles: number; projMembershipRoles: number };
};

const ROLE_SELECT = {
  id: true, workspaceId: true, name: true, scope: true, isSystem: true, description: true, color: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { wsMembershipRoles: true, projMembershipRoles: true } },
} as const;

/**
 * Danh mục vai trò: gồm role HỆ THỐNG (workspaceId=null, dùng chung, chỉ đọc) + role
 * CUSTOM của workspace (sửa/xoá được). Quyền sửa/xoá gated bởi MEMBER_MANAGE ở controller.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async list(workspaceId: string, scope?: RoleScope) {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }], ...(scope ? { scope } : {}) },
      orderBy: [{ isSystem: 'desc' }, { scope: 'asc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
    return roles.map((r) => this.toDto(r as RoleRow));
  }

  async create(workspaceId: string, input: CreateRoleInput) {
    const permIds = await this.permIds(input.permissionKeys);
    const role = await this.prisma.role.create({
      data: {
        workspaceId, name: input.name.trim(), scope: input.scope, isSystem: false,
        description: input.description ?? null, color: input.color ?? null,
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
      select: ROLE_SELECT,
    });
    return this.toDto(role as RoleRow);
  }

  async update(workspaceId: string, id: string, input: UpdateRoleInput) {
    await this.assertCustom(workspaceId, id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    if (input.permissionKeys) {
      const permIds = await this.permIds(input.permissionKeys);
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      data.permissions = { create: permIds.map((permissionId) => ({ permissionId })) };
    }
    const role = await this.prisma.role.update({ where: { id }, data, select: ROLE_SELECT });
    await this.rbac.invalidateWorkspace(workspaceId); // quyền role đổi → xoá cache toàn workspace
    return this.toDto(role as RoleRow);
  }

  async remove(workspaceId: string, id: string) {
    const role = await this.assertCustom(workspaceId, id);
    const count = role._count.wsMembershipRoles + role._count.projMembershipRoles;
    if (count > 0) {
      throw new ForbiddenAppException(`Vai trò đang gán cho ${count} thành viên — gỡ khỏi họ trước khi xoá`);
    }
    await this.prisma.role.delete({ where: { id } });
    await this.rbac.invalidateWorkspace(workspaceId);
    return { success: true };
  }

  // ── helpers ──
  private toDto(r: RoleRow) {
    const meta = SYSTEM_ROLE_META[r.name as keyof typeof SYSTEM_ROLE_META];
    return {
      id: r.id, workspaceId: r.workspaceId, name: r.name, scope: r.scope, isSystem: r.isSystem,
      description: r.description ?? (r.isSystem ? meta?.description ?? null : null),
      color: r.color ?? (r.isSystem ? meta?.color ?? null : null),
      permissionKeys: r.permissions.map((p) => p.permission.key),
      memberCount: r._count.wsMembershipRoles + r._count.projMembershipRoles,
    };
  }

  private async assertCustom(workspaceId: string, id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: { id: true, isSystem: true, workspaceId: true, _count: { select: { wsMembershipRoles: true, projMembershipRoles: true } } },
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
    const rows = await this.prisma.permission.findMany({ where: { key: { in: valid } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
