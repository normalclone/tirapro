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
 * Quy tắc: dự án công khai → ai trong workspace cũng thấy; dự án riêng tư → chỉ thành viên dự án
 * (`ProjectMembership`) + admin hệ thống + người có quyền hiệu lực `workspace:admin`.
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
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true },
    });
    if (u?.isSystemAdmin) return true;
    return (await this.rbac.getEffectivePermissions(userId, workspaceId)).has('workspace:admin');
  }

  /**
   * Điều kiện lồng vào `project: {...}` của model con hoặc `where` của Project. Admin → `{}`.
   * Người thường: công khai HOẶC là thành viên dự án.
   */
  async visibleWhere(userId: string, workspaceId: string): Promise<Prisma.ProjectWhereInput> {
    if (await this.seesAll(userId, workspaceId)) return {};
    return { OR: [{ isPrivate: false }, { memberships: { some: { userId } } }] };
  }

  /** `null` = thấy tất cả (admin); ngược lại tập id dự án (dùng cho raw SQL / full-text). */
  async visibleProjectIds(userId: string, workspaceId: string): Promise<string[] | null> {
    if (await this.seesAll(userId, workspaceId)) return null;
    const rows = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null, ...(await this.visibleWhere(userId, workspaceId)) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Ném `NotFoundAppException('Dự án')` nếu không thấy được. */
  async assertCanSee(userId: string, workspaceId: string, projectId: string): Promise<void> {
    await this.rbac.assertProjectVisible(userId, workspaceId, projectId);
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

  /** Gọi sau khi đổi cờ riêng tư: bỏ cache quyền hiệu lực (60s) để không còn quyền cũ của người vừa mất/được thấy. */
  async onVisibilityChanged(workspaceId: string): Promise<void> {
    await this.rbac.invalidateWorkspace(workspaceId);
  }
}
