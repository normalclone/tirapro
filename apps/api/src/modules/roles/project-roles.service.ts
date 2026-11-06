import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUDIT_ACTIONS, DOMAIN_EVENTS, PERMISSION_CATALOG } from '@tirapro/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { CreateProjectRoleInput, UpdateProjectRoleInput } from './roles.schemas';

/** Quyền CẤP DỰ ÁN trong catalog — vai trò riêng của dự án chỉ được chứa các quyền này (không có quyền cấp tổ chức). */
const PROJECT_PERMISSION_KEYS = new Set<string>(
  PERMISSION_CATALOG.filter((p) => p.scope === 'PROJECT').map((p) => p.key),
);

const SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  name: true,
  description: true,
  color: true,
  updatedAt: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { projMembershipRoles: true } },
} as const;

type Row = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
  _count: { projMembershipRoles: number };
};

export interface ProjectRoleDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  permissionKeys: string[];
  memberCount: number;
  updatedAt: string;
}

/**
 * Vai trò RIÊNG của dự án — Project Admin của chính dự án tạo/sửa/xoá (route do guard `@ProjectRef` + `project:admin` chặn). Có hai
 * cách tạo: "từ mẫu" (sao chép tên + quyền một mẫu vai trò cấp dự án, sửa tự do sau đó) hoặc tự chọn quyền. Quyết định: Project Admin
 * được cấp BẤT KỲ quyền cấp dự án nào (kể cả `project:admin`) — họ vốn đã có `project:admin`; quyền cấp tổ chức thì không bao giờ.
 */
@Injectable()
export class ProjectRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async list(organizationId: string, projectId: string): Promise<ProjectRoleDto[]> {
    const rows = await this.prisma.role.findMany({
      where: { organizationId, projectId, scope: 'PROJECT' },
      orderBy: { name: 'asc' },
      select: SELECT,
    });
    return rows.map((r) => this.toDto(projectId, r));
  }

  async create(
    organizationId: string,
    projectId: string,
    input: CreateProjectRoleInput,
    actorId: string,
  ): Promise<ProjectRoleDto> {
    let name = input.name?.trim();
    let description = input.description ?? null;
    let color = input.color ?? null;
    let keys = input.permissionKeys;
    if (input.fromTemplateId) {
      const tpl = await this.prisma.role.findFirst({
        where: {
          id: input.fromTemplateId,
          scope: 'PROJECT',
          projectId: null,
          OR: [{ organizationId }, { organizationId: null }],
        },
        select: {
          name: true,
          description: true,
          color: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      });
      if (!tpl) throw new NotFoundAppException('Mẫu vai trò');
      name = name || tpl.name;
      description = input.description ?? tpl.description;
      color = input.color ?? tpl.color;
      // Sao chép quyền của mẫu (chỉ phần cấp dự án); `permissionKeys` gửi kèm thì ghi đè.
      keys =
        input.permissionKeys ??
        tpl.permissions.map((p) => p.permission.key).filter((k) => PROJECT_PERMISSION_KEYS.has(k));
    }
    if (!name) throw new BusinessRuleException('Tên vai trò bắt buộc');
    const permissionKeys = this.assertProjectPermissions(keys ?? []);
    await this.assertNameFree(projectId, name);
    const permIds = await this.permIds(permissionKeys);
    const role = await this.prisma.role.create({
      data: {
        organizationId,
        projectId,
        name,
        scope: 'PROJECT',
        isSystem: false,
        description,
        color,
        permissions: { create: permIds.map((permissionId) => ({ permissionId })) },
      },
      select: SELECT,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entityType: 'role',
      entityId: role.id,
      summary: `Tạo vai trò "${role.name}" của dự án`,
      meta: {
        name: role.name,
        projectId,
        fromTemplateId: input.fromTemplateId ?? null,
        permissionCount: permIds.length,
      },
    });
    return this.toDto(projectId, role);
  }

  async update(
    organizationId: string,
    projectId: string,
    roleId: string,
    input: UpdateProjectRoleInput,
    actorId: string,
  ): Promise<ProjectRoleDto> {
    await this.requireOwn(organizationId, projectId, roleId);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      await this.assertNameFree(projectId, name, roleId);
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.color !== undefined) data.color = input.color;
    let permIds: string[] | null = null;
    if (input.permissionKeys) {
      permIds = await this.permIds(this.assertProjectPermissions(input.permissionKeys));
    }
    const role = await this.prisma.$transaction(async (tx) => {
      if (permIds) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        data.permissions = { create: permIds.map((permissionId) => ({ permissionId })) };
      }
      return tx.role.update({ where: { id: roleId }, data, select: SELECT });
    });
    // Quyền của vai trò đổi → xoá cache quyền tổ chức và để gateway rà lại socket (rút người mất quyền xem).
    await this.rbac.invalidateOrganization(organizationId);
    if (input.permissionKeys) this.events.emit(DOMAIN_EVENTS.ACCESS_CHANGED, { organizationId });
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      entityType: 'role',
      entityId: role.id,
      summary: `Sửa vai trò "${role.name}" của dự án`,
      meta: {
        projectId,
        changed: Object.keys(input).filter(
          (k) => input[k as keyof UpdateProjectRoleInput] !== undefined,
        ),
        permissionCount: role.permissions.length,
      },
    });
    return this.toDto(projectId, role);
  }

  /** Xoá vai trò đang được gán → 422 kèm số người đang dùng (gỡ khỏi họ trước). */
  async remove(
    organizationId: string,
    projectId: string,
    roleId: string,
    actorId: string,
  ): Promise<{ success: true }> {
    const role = await this.requireOwn(organizationId, projectId, roleId);
    const used = role._count.projMembershipRoles;
    if (used > 0) {
      throw new BusinessRuleException(
        `Vai trò "${role.name}" đang gán cho ${used} người — gỡ khỏi họ trước khi xoá`,
      );
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.rbac.invalidateOrganization(organizationId);
    await this.audit.record({
      organizationId,
      actorId,
      action: AUDIT_ACTIONS.ROLE_DELETED,
      entityType: 'role',
      entityId: roleId,
      summary: `Xoá vai trò "${role.name}" của dự án`,
      meta: { name: role.name, projectId },
    });
    return { success: true };
  }

  // ── helpers ──

  /** Chỉ vai trò RIÊNG của đúng dự án này (mẫu / vai trò dự án khác → 404 như không tồn tại). */
  private async requireOwn(organizationId: string, projectId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId, projectId, scope: 'PROJECT' },
      select: { id: true, name: true, _count: { select: { projMembershipRoles: true } } },
    });
    if (!role) throw new NotFoundAppException('Vai trò');
    return role;
  }

  /** Quyền gửi lên phải có trong catalog và thuộc cấp DỰ ÁN; khử trùng. */
  private assertProjectPermissions(keys: string[]): string[] {
    const unique = [...new Set(keys)];
    const bad = unique.filter((k) => !PROJECT_PERMISSION_KEYS.has(k));
    if (bad.length) {
      throw new BusinessRuleException(
        `Vai trò của dự án chỉ chứa quyền cấp dự án — không hợp lệ: ${bad.join(', ')}`,
      );
    }
    return unique;
  }

  /** Tên duy nhất trong dự án (không phân biệt hoa thường). */
  private async assertNameFree(projectId: string, name: string, exceptId?: string): Promise<void> {
    const dup = await this.prisma.role.findFirst({
      where: {
        projectId,
        scope: 'PROJECT',
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (dup) throw new BusinessRuleException(`Dự án đã có vai trò tên "${name}"`);
  }

  private async permIds(keys: string[]): Promise<string[]> {
    if (!keys.length) return [];
    const rows = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private toDto(projectId: string, r: Row): ProjectRoleDto {
    return {
      id: r.id,
      projectId,
      name: r.name,
      description: r.description,
      color: r.color,
      permissionKeys: r.permissions.map((p) => p.permission.key),
      memberCount: r._count.projMembershipRoles,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
