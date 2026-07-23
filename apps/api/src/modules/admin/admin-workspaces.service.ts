import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { offsetPage } from '../../common/dto/page-result';
import type { PatchWorkspaceInput } from './admin-console.schemas';

const WS_SELECT = {
  id: true, name: true, slug: true, plan: true, deletedAt: true, createdAt: true,
  owner: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
  _count: { select: { memberships: true, projects: true, issues: true } },
} as const;

/** Quản trị mọi workspace (tenant) toàn hệ thống — chỉ admin hệ thống. */
@Injectable()
export class AdminWorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(w: {
    id: string; name: string; slug: string; plan: string; deletedAt: Date | null; createdAt: Date;
    owner: { id: string; displayName: string; email: string; avatarUrl: string | null };
    _count: { memberships: number; projects: number; issues: number };
  }, lastActivityAt: Date | null) {
    return {
      id: w.id, name: w.name, slug: w.slug, plan: w.plan,
      archived: w.deletedAt != null,
      createdAt: w.createdAt.toISOString(),
      owner: w.owner,
      members: w._count.memberships, projects: w._count.projects, issues: w._count.issues,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
    };
  }

  async list() {
    const [rows, activity] = await Promise.all([
      this.prisma.workspace.findMany({ orderBy: { createdAt: 'asc' }, select: WS_SELECT }),
      this.prisma.activityLog.groupBy({ by: ['workspaceId'], _max: { createdAt: true } }),
    ]);
    const last = new Map(activity.map((a) => [a.workspaceId, a._max.createdAt]));
    const data = rows.map((w) => this.toDto(w, last.get(w.id) ?? null));
    return offsetPage(data, 1, Math.max(1, data.length), data.length);
  }

  private async one(id: string) {
    const [w, act] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id }, select: WS_SELECT }),
      this.prisma.activityLog.aggregate({ where: { workspaceId: id }, _max: { createdAt: true } }),
    ]);
    if (!w) throw new NotFoundAppException('Workspace');
    return this.toDto(w, act._max.createdAt ?? null);
  }

  async patch(id: string, input: PatchWorkspaceInput) {
    const ws = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!ws) throw new NotFoundAppException('Workspace');

    if (input.ownerId) {
      const member = await this.prisma.workspaceMembership.findFirst({
        where: { workspaceId: id, userId: input.ownerId },
        select: { id: true },
      });
      if (!member) throw new BusinessRuleException('Chủ sở hữu mới phải là thành viên của workspace');
    }

    await this.prisma.workspace.update({
      where: { id },
      data: {
        ...(input.plan ? { plan: input.plan } : {}),
        ...(typeof input.archived === 'boolean' ? { deletedAt: input.archived ? new Date() : null } : {}),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      },
    });
    return this.one(id);
  }
}
