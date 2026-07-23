import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { Request } from 'express';
import { SYSTEM_ROLES } from '@tirapro/types';
import type { CreateWorkspaceInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BusinessRuleException, ForbiddenAppException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bootstrap: WorkspaceBootstrapService,
    private readonly media: MediaService,
  ) {}

  /** Tạo workspace mới + clone catalog config + gán người tạo làm Workspace Admin. */
  async create(userId: string, input: CreateWorkspaceInput): Promise<{ id: string; name: string; slug: string }> {
    // Chỉ admin hệ thống hoặc user được cấp quyền mới tạo được workspace.
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true, canCreateWorkspace: true },
    });
    if (!actor?.isSystemAdmin && !actor?.canCreateWorkspace) {
      throw new ForbiddenAppException('Bạn không có quyền tạo workspace — liên hệ admin hệ thống để được cấp quyền');
    }
    return this.prisma.$transaction(async (tx) => {
      const slug = await this.uniqueSlug(tx, input.name);
      const ws = await tx.workspace.create({
        data: { name: input.name, slug, ownerId: userId, plan: 'FREE', createdById: userId },
      });
      await this.bootstrap.bootstrap(tx, ws.id);
      const adminRole = await tx.role.findFirst({
        where: { name: SYSTEM_ROLES.WORKSPACE_ADMIN, scope: 'WORKSPACE', workspaceId: null, isSystem: true },
        select: { id: true },
      });
      if (!adminRole) throw new BusinessRuleException('Thiếu vai trò hệ thống WORKSPACE_ADMIN');
      await tx.workspaceMembership.create({ data: { workspaceId: ws.id, userId, roleId: adminRole.id } });
      return { id: ws.id, name: ws.name, slug: ws.slug };
    });
  }

  /** Đặt logo/ảnh workspace (chỉ workspace admin của workspace hiện tại). */
  async setAvatar(workspaceId: string, file: Express.Multer.File | undefined, req: Request) {
    const prev = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Workspace');
    const avatarUrl = await this.media.saveAvatar(file, 'ws', req);
    const ws = await this.prisma.workspace.update({ where: { id: workspaceId }, data: { avatarUrl } });
    await this.media.removeByUrl(prev.avatarUrl);
    return { id: ws.id, name: ws.name, slug: ws.slug, avatarUrl: ws.avatarUrl };
  }

  /** Gỡ logo/ảnh workspace. */
  async clearAvatar(workspaceId: string) {
    const prev = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Workspace');
    const ws = await this.prisma.workspace.update({ where: { id: workspaceId }, data: { avatarUrl: null } });
    await this.media.removeByUrl(prev.avatarUrl);
    return { id: ws.id, name: ws.name, slug: ws.slug, avatarUrl: ws.avatarUrl };
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';
    let slug = base;
    let i = 2;
    while (await tx.workspace.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 50) {
        slug = `${base}-${createId().slice(0, 6)}`;
        break;
      }
    }
    return slug;
  }
}
