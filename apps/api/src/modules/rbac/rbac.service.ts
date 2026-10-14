import { Injectable } from '@nestjs/common';
import { DEFAULT_PROJECT_ROLE_BY_WS_ROLE } from '@tirapro/types';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import type { ProjectRefKind } from '../../common/decorators/project-ref.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Resolve quyền hiệu lực = union(vai trò workspace, vai trò project). Cache Redis 60s
 * (key embed workspaceId+userId+projectId). Redis down => tính trực tiếp từ Prisma.
 */
@Injectable()
export class RbacService {
  private readonly TTL = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private cacheKey(userId: string, workspaceId: string, projectId?: string | null): string {
    return `rbac:${workspaceId}:${userId}:${projectId ?? '-'}`;
  }

  async getEffectivePermissions(
    userId: string,
    workspaceId: string,
    projectId?: string | null,
  ): Promise<Set<string>> {
    const key = this.cacheKey(userId, workspaceId, projectId);
    const client = this.redis.getClient();
    if (client && this.redis.isAvailable()) {
      try {
        const cached = await client.get(key);
        if (cached) return new Set(JSON.parse(cached) as string[]);
      } catch {
        /* degrade: tính trực tiếp */
      }
    }

    const perms = await this.compute(userId, workspaceId, projectId);
    if (client && this.redis.isAvailable()) {
      // jittered TTL backstop chống thundering invalidation
      const ttl = this.TTL + Math.floor((userId.charCodeAt(0) || 0) % 20);
      client.set(key, JSON.stringify([...perms]), 'EX', ttl).catch(() => undefined);
    }
    return perms;
  }

  private async compute(
    userId: string,
    workspaceId: string,
    projectId?: string | null,
  ): Promise<Set<string>> {
    const roleIds: string[] = [];

    // 1 thành viên có thể NHIỀU vai trò → union vai trò chính (roleId) + các vai trò phụ (join).
    const wsMembership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { roleId: true, roles: { select: { role: { select: { id: true, name: true } } } } },
    });
    const wsRoleNames: string[] = [];
    if (wsMembership) {
      roleIds.push(wsMembership.roleId, ...wsMembership.roles.map((r) => r.role.id));
      wsRoleNames.push(...wsMembership.roles.map((r) => r.role.name));
    }

    if (projectId) {
      const projMembership = await this.prisma.projectMembership.findUnique({
        // Giới hạn theo workspace: membership dự án của workspace khác không được tính.
        where: { projectId_userId: { projectId, userId }, project: { workspaceId } },
        select: { roleId: true, roles: { select: { roleId: true } } },
      });
      if (projMembership) {
        // Có GHI ĐÈ vai trò riêng ở dự án này → dùng đúng vai trò đó.
        roleIds.push(projMembership.roleId, ...projMembership.roles.map((r) => r.roleId));
      } else if (wsMembership) {
        // Không ghi đè → áp vai trò dự án MẶC ĐỊNH suy từ vai trò workspace
        // (thành viên tính trên workspace; mọi dự án dùng chung tập người dùng).
        roleIds.push(...(await this.defaultProjectRoleIds(workspaceId, wsRoleNames)));
      }
    }

    if (roleIds.length === 0) return new Set();

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { permission: { select: { key: true } } },
    });
    return new Set(rows.map((r) => r.permission.key));
  }

  /**
   * Vai trò DỰ ÁN mặc định (id) suy từ các vai trò WORKSPACE của user.
   * Map ở `DEFAULT_PROJECT_ROLE_BY_WS_ROLE` (@tirapro/types) — vai trò không có
   * trong map (vd vai trò tuỳ biến) thì không tự cấp quyền dự án.
   */
  private async defaultProjectRoleIds(workspaceId: string, wsRoleNames: string[]): Promise<string[]> {
    const mapped: string[] = [];
    for (const n of wsRoleNames) {
      const target = DEFAULT_PROJECT_ROLE_BY_WS_ROLE[n];
      if (target) mapped.push(target);
    }
    const wanted = [...new Set(mapped)];
    if (wanted.length === 0) return [];
    const rows = await this.prisma.role.findMany({
      where: { name: { in: wanted }, scope: 'PROJECT', OR: [{ workspaceId }, { workspaceId: null }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Lấy projectId THẬT của tài nguyên, chỉ khi tài nguyên thuộc workspace hiện tại
   * (issue có workspaceId riêng; sprint/board/label/component lọc qua project.workspaceId).
   */
  async resolveProjectId(
    workspaceId: string,
    kind: Exclude<ProjectRefKind, 'param' | 'body' | 'query'>,
    value: string,
  ): Promise<string | null> {
    const select = { projectId: true } as const;
    const viaProject = { id: value, project: { workspaceId } };
    let row: { projectId: string } | null;
    switch (kind) {
      case 'issue':
        row = await this.prisma.issue.findFirst({ where: { id: value, workspaceId }, select });
        break;
      case 'sprint':
        row = await this.prisma.sprint.findFirst({ where: viaProject, select });
        break;
      case 'board':
        row = await this.prisma.board.findFirst({ where: viaProject, select });
        break;
      case 'label':
        row = await this.prisma.label.findFirst({ where: viaProject, select });
        break;
      case 'component':
        row = await this.prisma.component.findFirst({ where: viaProject, select });
        break;
    }
    return row?.projectId ?? null;
  }

  /** Dự án phải thuộc workspace hiện tại, nếu không coi như không tồn tại. */
  async assertProjectInWorkspace(projectId: string, workspaceId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });
    if (!project) throw new NotFoundAppException('Dự án');
  }

  /** Invalidate cache khi đổi vai trò của 1 user (gọi từ MembersModule). */
  async invalidate(userId: string, workspaceId: string): Promise<void> {
    await this.unlinkByPattern(`rbac:${workspaceId}:${userId}:*`);
  }

  /** Invalidate toàn bộ cache của workspace (khi sửa quyền của 1 role → ảnh hưởng nhiều user). */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await this.unlinkByPattern(`rbac:${workspaceId}:*`);
  }

  /** Xoá key theo pattern bằng SCAN + UNLINK (không dùng KEYS vì chặn Redis). Redis down → bỏ qua. */
  private async unlinkByPattern(match: string): Promise<void> {
    const client = this.redis.getClient();
    if (!client || !this.redis.isAvailable()) return;
    try {
      for await (const batch of client.scanStream({ match, count: 200 })) {
        const keys = batch as string[];
        if (keys.length) await client.unlink(...keys);
      }
    } catch {
      /* ignore: cache còn lại tự hết hạn theo TTL */
    }
  }
}
