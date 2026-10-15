import { Injectable } from '@nestjs/common';
import { DEFAULT_PROJECT_ROLE_BY_WS_ROLE } from '@tirapro/types';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import type { ProjectResourceKind } from '../../common/decorators/project-ref.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

type ResolverDelegate = { findFirst(args: { where: object; select: object }): Promise<unknown> };

const projectIdOnly = { projectId: true } as const;
// Sprint/board/nhãn/... của dự án đã xoá mềm = không tồn tại (guard trả 404, không cho start/complete/setColumns...).
const viaProject = (value: string, workspaceId: string) => ({
  id: value,
  project: { workspaceId, deletedAt: null },
});
// Issue của dự án đã xoá mềm = không tồn tại (mọi route theo issue id → guard trả 404).
const issueInLiveProject = (value: string, workspaceId: string) => ({
  id: value,
  workspaceId,
  project: { deletedAt: null },
});
// Điều kiện đầu issue: thuộc workspace và dự án chưa bị xoá mềm.
const liveIssueEnd = (workspaceId: string) => ({ workspaceId, project: { deletedAt: null } });
const inWorkspace = (value: string, workspaceId: string) => ({ id: value, workspaceId });
const ownProjectId = (row: { projectId: string | null }) => row.projectId;

/**
 * Bảng tra: loại tài nguyên → model Prisma, điều kiện (luôn giới hạn theo workspace), cột select,
 * và cách lấy projectId từ hàng tìm được.
 */
const RESOURCE_RESOLVERS: Record<
  ProjectResourceKind,
  {
    model: string;
    where: (value: string, workspaceId: string) => object;
    select: object;
    project: (row: never, workspaceId: string) => string | null;
  }
> = {
  issue: {
    model: 'issue',
    where: issueInLiveProject,
    select: projectIdOnly,
    project: ownProjectId,
  },
  sprint: { model: 'sprint', where: viaProject, select: projectIdOnly, project: ownProjectId },
  board: { model: 'board', where: viaProject, select: projectIdOnly, project: ownProjectId },
  label: { model: 'label', where: viaProject, select: projectIdOnly, project: ownProjectId },
  component: {
    model: 'component',
    where: viaProject,
    select: projectIdOnly,
    project: ownProjectId,
  },
  version: { model: 'version', where: viaProject, select: projectIdOnly, project: ownProjectId },
  recurringIssue: {
    model: 'recurringIssue',
    where: viaProject,
    select: projectIdOnly,
    project: ownProjectId,
  },
  // Tài nguyên cấp workspace, dự án là tuỳ chọn (null = áp quyền workspace).
  raid: { model: 'raidItem', where: inWorkspace, select: projectIdOnly, project: ownProjectId },
  automationTemplate: {
    model: 'issueTemplate',
    where: inWorkspace,
    select: projectIdOnly,
    project: ownProjectId,
  },
  automationRule: {
    model: 'automationRule',
    where: inWorkspace,
    select: projectIdOnly,
    project: ownProjectId,
  },
  // Worklog đi qua issue cha.
  worklog: {
    model: 'workLog',
    where: (value, workspaceId) => ({ id: value, issue: liveIssueEnd(workspaceId) }),
    select: { issue: { select: projectIdOnly } },
    project: (row: { issue: { projectId: string } }) => row.issue.projectId,
  },
  customField: {
    model: 'customField',
    where: inWorkspace,
    select: projectIdOnly,
    project: ownProjectId,
  },
  repository: {
    model: 'codeRepository',
    where: inWorkspace,
    select: projectIdOnly,
    project: ownProjectId,
  },
  comment: {
    model: 'comment',
    where: (value, workspaceId) => ({ id: value, issue: liveIssueEnd(workspaceId) }),
    select: { issue: { select: projectIdOnly } },
    project: (row: { issue: { projectId: string } }) => row.issue.projectId,
  },
  // Đính kèm gắn thẳng vào issue hoặc vào comment của issue; mồ côi (không issue) → không tìm thấy.
  attachment: {
    model: 'attachment',
    where: (value, workspaceId) => ({
      id: value,
      OR: [{ issue: liveIssueEnd(workspaceId) }, { comment: { issue: liveIssueEnd(workspaceId) } }],
    }),
    select: {
      issue: { select: projectIdOnly },
      comment: { select: { issue: { select: projectIdOnly } } },
    },
    project: (row: {
      issue: { projectId: string } | null;
      comment: { issue: { projectId: string } } | null;
    }) => row.issue?.projectId ?? row.comment?.issue.projectId ?? null,
  },
  // Hai đầu có thể khác dự án: lấy đầu thuộc workspace hiện tại (ưu tiên đầu nguồn).
  // Link có một đầu ở dự án đã xoá mềm = không tồn tại (cả hai đầu đều phải ở dự án còn sống).
  issueLink: {
    model: 'issueLink',
    where: (value, workspaceId) => ({
      id: value,
      source: { project: { deletedAt: null } },
      target: { project: { deletedAt: null } },
      OR: [{ source: { workspaceId } }, { target: { workspaceId } }],
    }),
    select: {
      source: { select: { projectId: true, workspaceId: true } },
      target: { select: { projectId: true, workspaceId: true } },
    },
    project: (
      row: { source: { projectId: string; workspaceId: string }; target: { projectId: string } },
      workspaceId,
    ) => (row.source.workspaceId === workspaceId ? row.source.projectId : row.target.projectId),
  },
  // Giá trị là KEY dự án (vd "ABC"), không phải id.
  projectKey: {
    model: 'project',
    where: (value, workspaceId) => ({ key: value.toUpperCase(), workspaceId }),
    select: { id: true },
    project: (row: { id: string }) => row.id,
  },
};

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
    // Không còn là thành viên workspace → KHÔNG quyền nào, kể cả khi còn sót bản ghi ghi đè vai trò dự án
    // (người bị gỡ không được giữ quyền dự án qua API key hoặc token cũ).
    if (!wsMembership) return new Set();
    const wsRoleNames: string[] = [];
    roleIds.push(wsMembership.roleId, ...wsMembership.roles.map((r) => r.role.id));
    wsRoleNames.push(...wsMembership.roles.map((r) => r.role.name));

    if (projectId) {
      const projMembership = await this.prisma.projectMembership.findUnique({
        // Giới hạn theo workspace: membership dự án của workspace khác không được tính.
        // Cố ý KHÔNG lọc project.deletedAt: đây chỉ tính quyền hiệu lực; dự án xoá mềm đã bị guard (`viaProject`/`@ProjectRef`) trả 404 trước khi tới đây.
        where: { projectId_userId: { projectId, userId }, project: { workspaceId } },
        select: { roleId: true, roles: { select: { roleId: true } } },
      });
      if (projMembership) {
        // Có GHI ĐÈ vai trò riêng ở dự án này → dùng đúng vai trò đó.
        roleIds.push(projMembership.roleId, ...projMembership.roles.map((r) => r.roleId));
      } else {
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
  private async defaultProjectRoleIds(
    workspaceId: string,
    wsRoleNames: string[],
  ): Promise<string[]> {
    const mapped: string[] = [];
    for (const n of wsRoleNames) {
      const target = DEFAULT_PROJECT_ROLE_BY_WS_ROLE[n];
      if (target) mapped.push(target);
    }
    const wanted = [...new Set(mapped)];
    if (wanted.length === 0) return [];
    const rows = await this.prisma.role.findMany({
      where: {
        name: { in: wanted },
        scope: 'PROJECT',
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Tra DB để suy ra dự án THẬT của tài nguyên, chỉ khi tài nguyên thuộc workspace hiện tại.
   * - `null`: không tìm thấy (hoặc thuộc workspace khác) → guard trả NotFound.
   * - `{ projectId: null }`: tài nguyên cấp workspace (raid/mẫu/custom field/repo không gắn dự án)
   *   → chỉ tính quyền cấp workspace.
   */
  async resolveProjectId(
    workspaceId: string,
    kind: ProjectResourceKind,
    value: string,
  ): Promise<{ projectId: string | null } | null> {
    const r = RESOURCE_RESOLVERS[kind];
    const delegate = (this.prisma as unknown as Record<string, ResolverDelegate | undefined>)[
      r.model
    ];
    if (!delegate) throw new Error(`Loại tài nguyên không hỗ trợ: ${String(kind)}`);
    const row = await delegate.findFirst({ where: r.where(value, workspaceId), select: r.select });
    if (!row) return null;
    return { projectId: r.project(row as never, workspaceId) };
  }

  /** Dự án phải thuộc workspace hiện tại, nếu không coi như không tồn tại. */
  async assertProjectInWorkspace(projectId: string, workspaceId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, deletedAt: null },
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
