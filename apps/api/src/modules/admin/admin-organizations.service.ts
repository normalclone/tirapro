import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import type { PatchOrganizationInput } from './admin-console.schemas';
import { ACTIVE_MEMBERSHIP_COUNT } from '../../common/active-member';

const WS_SELECT = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  deletedAt: true,
  createdAt: true,
  owner: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
  // `memberships` = số thành viên ĐANG HOẠT ĐỘNG (cùng quy tắc bộ chọn tổ chức), không phải mọi dòng membership.
  _count: { select: { memberships: ACTIVE_MEMBERSHIP_COUNT, projects: true, issues: true } },
} as const;

/** Quản trị mọi tổ chức (tenant) toàn hệ thống — chỉ admin hệ thống. */
@Injectable()
export class AdminOrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(
    w: {
      id: string;
      name: string;
      slug: string;
      plan: string;
      deletedAt: Date | null;
      createdAt: Date;
      owner: { id: string; displayName: string; email: string; avatarUrl: string | null };
      _count: { memberships: number; projects: number; issues: number };
    },
    lastActivityAt: Date | null,
  ) {
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      plan: w.plan,
      archived: w.deletedAt != null,
      createdAt: w.createdAt.toISOString(),
      owner: w.owner,
      members: w._count.memberships,
      projects: w._count.projects,
      issues: w._count.issues,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
    };
  }

  async list() {
    const [rows, activity] = await Promise.all([
      // allow-deleted: console admin liệt kê cả tổ chức đã lưu trữ (cờ `archived`)
      this.prisma.organization.findMany({ orderBy: { createdAt: 'asc' }, select: WS_SELECT }),
      this.prisma.activityLog.groupBy({ by: ['organizationId'], _max: { createdAt: true } }),
    ]);
    const last = new Map(activity.map((a) => [a.organizationId, a._max.createdAt]));
    const data = rows.map((w) => this.toDto(w, last.get(w.id) ?? null));
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  private async one(id: string) {
    const [w, act] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id }, select: WS_SELECT }),
      this.prisma.activityLog.aggregate({
        where: { organizationId: id },
        _max: { createdAt: true },
      }),
    ]);
    if (!w) throw new NotFoundAppException('Tổ chức');
    return this.toDto(w, act._max.createdAt ?? null);
  }

  async patch(id: string, input: PatchOrganizationInput) {
    const ws = await this.prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!ws) throw new NotFoundAppException('Tổ chức');

    if (input.ownerId) {
      const member = await this.prisma.organizationMembership.findFirst({
        where: { organizationId: id, userId: input.ownerId },
        select: { id: true },
      });
      if (!member)
        throw new BusinessRuleException(
          'Chủ sở hữu mới phải là thành viên của tổ chức này — hãy thêm họ vào danh sách thành viên trước',
        );
    }

    await this.prisma.organization.update({
      where: { id },
      data: {
        ...(input.plan ? { plan: input.plan } : {}),
        ...(typeof input.archived === 'boolean'
          ? { deletedAt: input.archived ? new Date() : null }
          : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      },
    });
    return this.one(id);
  }
}
