import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MailStatus, type MailOutboxItemDto } from '@tirapro/types';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { PrismaService } from '../../infra/prisma/prisma.service';

const listQuerySchema = z.object({
  status: z.nativeEnum(MailStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type ListQuery = z.infer<typeof listQuerySchema>;

/** Hộp thư đi — CHỈ admin hệ thống. Trả metadata, không trả nội dung thư (có thể chứa liên kết còn hiệu lực). */
@ApiTags('admin')
@AuthOnly() // Chỉ admin hệ thống: handler tự kiểm isSystemAdmin, không thuộc RBAC workspace.
@Controller('admin/mail-outbox')
export class MailAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<MailOutboxItemDto[]> {
    if (!user.isSystemAdmin)
      throw new ForbiddenAppException('Chỉ admin hệ thống mới xem được hộp thư đi');
    const rows = await this.prisma.emailOutbox.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        to: true,
        subject: true,
        template: true,
        status: true,
        attempts: true,
        lastError: true,
        scheduledAt: true,
        sentAt: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      scheduledAt: r.scheduledAt.toISOString(),
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
