import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import type { Request } from 'express';
import { SYSTEM_ROLES } from '@tirapro/types';
import type { CreateOrganizationInput } from '@tirapro/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  BusinessRuleException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../common/exceptions/app.exception';
import { MediaService } from '../media/media.service';
import { OrganizationBootstrapService } from './organization-bootstrap.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bootstrap: OrganizationBootstrapService,
    private readonly media: MediaService,
  ) {}

  /** Tạo tổ chức mới + clone catalog config + gán người tạo làm Organization Admin. */
  async create(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<{ id: string; name: string; slug: string }> {
    // Chỉ admin hệ thống hoặc user được cấp quyền mới tạo được organization.
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemAdmin: true, canCreateOrganization: true },
    });
    if (!actor?.isSystemAdmin && !actor?.canCreateOrganization) {
      throw new ForbiddenAppException(
        'Bạn không có quyền tạo tổ chức — hãy liên hệ Quản trị để được cấp quyền',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const slug = await this.uniqueSlug(tx, input.name);
      const ws = await tx.organization.create({
        data: { name: input.name, slug, ownerId: userId, plan: 'FREE', createdById: userId },
      });
      await this.bootstrap.bootstrap(tx, ws.id);
      const adminRole = await tx.role.findFirst({
        where: {
          name: SYSTEM_ROLES.ORGANIZATION_ADMIN,
          scope: 'ORGANIZATION',
          organizationId: null,
          isSystem: true,
        },
        select: { id: true },
      });
      if (!adminRole) throw new BusinessRuleException('Thiếu vai trò hệ thống ORGANIZATION_ADMIN');
      await tx.organizationMembership.create({
        data: {
          organizationId: ws.id,
          userId,
          roleId: adminRole.id,
          joinedAt: new Date(),
          roles: { create: [{ roleId: adminRole.id }] },
        },
      });
      return { id: ws.id, name: ws.name, slug: ws.slug };
    });
  }

  /** Đặt logo/ảnh tổ chức (chỉ tổ chức admin của tổ chức hiện tại). */
  async setAvatar(organizationId: string, file: Express.Multer.File | undefined, req: Request) {
    const prev = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Tổ chức');
    const avatarUrl = await this.media.saveAvatar(file, 'ws', req);
    const ws = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { avatarUrl },
    });
    await this.media.removeByUrl(prev.avatarUrl);
    return { id: ws.id, name: ws.name, slug: ws.slug, avatarUrl: ws.avatarUrl };
  }

  /** Gỡ logo/ảnh organization. */
  async clearAvatar(organizationId: string) {
    const prev = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { avatarUrl: true },
    });
    if (!prev) throw new NotFoundAppException('Tổ chức');
    const ws = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { avatarUrl: null },
    });
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
        .slice(0, 40) || 'organization';
    let slug = base;
    let i = 2;
    while (await tx.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 50) {
        slug = `${base}-${createId().slice(0, 6)}`;
        break;
      }
    }
    return slug;
  }
}
