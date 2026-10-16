import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RbacService } from './rbac.service';

/**
 * NGUỒN SỰ THẬT duy nhất cho "người này có thấy dự án này không" (dự án riêng tư).
 * Mọi đường đọc chéo dự án (danh sách, tìm kiếm/JQL, Cmd+K, thông báo, dashboard, digest, wiki, OKR…)
 * phải dùng `visibleWhere` / `visibleProjectIds` / `canSee` thay vì tự viết điều kiện.
 *
 * MỘT định nghĩa "thấy" (`RbacService.projectVisibilityMode`, dùng chung cho cả guard và các hàm dưới đây):
 * - admin hệ thống / `workspace:admin` → thấy mọi dự án;
 * - vai cấp workspace có `project:view` → dự án công khai + dự án riêng tư mình là thành viên (`ProjectMembership`);
 * - vai cấp workspace KHÔNG có `project:view` → chỉ dự án mình là thành viên.
 * Người ngoài nhận 404 (không 403) để không lộ sự tồn tại của dự án.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /** Admin hệ thống hoặc quyền hiệu lực workspace:admin → thấy mọi dự án riêng tư. */
  async seesAll(userId: string, workspaceId: string): Promise<boolean> {
    return (await this.rbac.projectVisibilityMode(userId, workspaceId)) === 'all';
  }

  /**
   * Điều kiện lồng vào `project: {...}` của model con hoặc `where` của Project. Admin → `{}`.
   * Người thường: công khai HOẶC là thành viên dự án; người không có `project:view` cấp workspace: chỉ dự án có vai trò.
   */
  async visibleWhere(userId: string, workspaceId: string): Promise<Prisma.ProjectWhereInput> {
    const mode = await this.rbac.projectVisibilityMode(userId, workspaceId);
    if (mode === 'all') return {};
    return mode === 'memberOnly' ? this.memberOnly(userId) : this.memberOrPublic(userId);
  }

  private memberOnly(userId: string): Prisma.ProjectWhereInput {
    return { memberships: { some: { userId } } };
  }

  /** Điều kiện cho người KHÔNG phải quản trị: công khai hoặc là thành viên dự án (không truy vấn). */
  private memberOrPublic(userId: string): Prisma.ProjectWhereInput {
    return { OR: [{ isPrivate: false }, { memberships: { some: { userId } } }] };
  }

  /**
   * `null` = thấy tất cả (admin); ngược lại tập id dự án (dùng cho raw SQL / full-text).
   * `known`: kết quả `visibleWhere` đã có của CÙNG người xem (tránh tính lại chế độ quyền) — `{}` = thấy tất cả.
   */
  async visibleProjectIds(
    userId: string,
    workspaceId: string,
    known?: Prisma.ProjectWhereInput,
  ): Promise<string[] | null> {
    const visible = known ?? (await this.visibleWhere(userId, workspaceId));
    if (Object.keys(visible).length === 0) return null;
    const rows = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, ...visible },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Ném `NotFoundAppException(notFoundLabel)` nếu không thấy được. Truyền `notFoundLabel` đúng nhãn của đường
   * "không tồn tại" cùng loại ở nơi gọi để 404 của dự án riêng tư giống hệt 404 của tài nguyên không có thật.
   */
  async assertCanSee(
    userId: string,
    workspaceId: string,
    projectId: string,
    notFoundLabel?: string,
  ): Promise<void> {
    await this.rbac.assertProjectVisible(userId, workspaceId, projectId, notFoundLabel);
  }

  async canSee(userId: string, workspaceId: string, projectId: string): Promise<boolean> {
    try {
      await this.assertCanSee(userId, workspaceId, projectId);
      return true;
    } catch (e) {
      if (e instanceof NotFoundAppException) return false;
      throw e;
    }
  }

  /** Gọi sau khi thêm/đổi thành viên dự án: bỏ cache quyền của từng người (cache khoá theo workspace+user+dự án). */
  async onMembersChanged(
    workspaceId: string,
    userIds: (string | null | undefined)[],
  ): Promise<void> {
    for (const id of new Set(userIds.filter((u): u is string => !!u))) {
      await this.rbac.invalidate(id, workspaceId);
    }
  }

  /** Gọi sau khi đổi cờ riêng tư: bỏ cache quyền hiệu lực (60s) để không còn quyền cũ của người vừa mất/được thấy. */
  async onVisibilityChanged(workspaceId: string): Promise<void> {
    await this.rbac.invalidateWorkspace(workspaceId);
  }
}
