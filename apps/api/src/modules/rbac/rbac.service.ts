import { Injectable } from '@nestjs/common';
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
      select: { roleId: true, roles: { select: { roleId: true } } },
    });
    if (wsMembership) roleIds.push(wsMembership.roleId, ...wsMembership.roles.map((r) => r.roleId));

    if (projectId) {
      const projMembership = await this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { roleId: true, roles: { select: { roleId: true } } },
      });
      if (projMembership) roleIds.push(projMembership.roleId, ...projMembership.roles.map((r) => r.roleId));
    }

    if (roleIds.length === 0) return new Set();

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { permission: { select: { key: true } } },
    });
    return new Set(rows.map((r) => r.permission.key));
  }

  /** Invalidate cache khi đổi vai trò của 1 user (gọi từ MembersModule). */
  async invalidate(userId: string, workspaceId: string): Promise<void> {
    const client = this.redis.getClient();
    if (!client || !this.redis.isAvailable()) return;
    try {
      const keys = await client.keys(`rbac:${workspaceId}:${userId}:*`);
      if (keys.length) await client.del(...keys);
    } catch {
      /* ignore */
    }
  }

  /** Invalidate toàn bộ cache của workspace (khi sửa quyền của 1 role → ảnh hưởng nhiều user). */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    const client = this.redis.getClient();
    if (!client || !this.redis.isAvailable()) return;
    try {
      const keys = await client.keys(`rbac:${workspaceId}:*`);
      if (keys.length) await client.del(...keys);
    } catch {
      /* ignore */
    }
  }
}
