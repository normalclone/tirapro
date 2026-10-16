import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { DIGEST_BLOCK_IDS } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { isValidTimeZone } from './digest-schedule';
import { DigestsService } from './digests.service';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';

const blocksSchema = z.array(z.enum(DIGEST_BLOCK_IDS)).max(DIGEST_BLOCK_IDS.length);

const recipientsSchema = z.array(z.string().min(1)).max(50);
const weekdaySchema = z.number().int().min(0).max(6);
const hourSchema = z.number().int().min(0).max(23);
const timezoneSchema = z.string().refine(isValidTimeZone, 'Múi giờ không hợp lệ');

const scheduleEnum = z.enum(['DAILY', 'WEEKLY', 'SPRINT_END', 'MANUAL']);

export const createDigestSchema = z.object({
  name: z.string().trim().min(1, 'Tên không được để trống').max(120),
  schedule: scheduleEnum.optional(),
  projectId: z.string().optional(),
  channelId: z.string().min(1).optional(),
  metrics: blocksSchema.optional(),
  recipients: recipientsSchema.optional(),
  deliverEmail: z.boolean().optional(),
  allowPrivateToChannel: z.boolean().optional(),
  weekday: weekdaySchema.optional(),
  hour: hourSchema.optional(),
  timezone: timezoneSchema.optional(),
});
type CreateDigestBody = z.infer<typeof createDigestSchema>;

export const updateDigestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  schedule: scheduleEnum.optional(),
  isEnabled: z.boolean().optional(),
  channelId: z.string().min(1).nullable().optional(),
  metrics: blocksSchema.optional(),
  recipients: recipientsSchema.optional(),
  deliverEmail: z.boolean().optional(),
  allowPrivateToChannel: z.boolean().optional(),
  weekday: weekdaySchema.optional(),
  hour: hourSchema.optional(),
  timezone: timezoneSchema.optional(),
});
type UpdateDigestBody = z.infer<typeof updateDigestSchema>;

export const previewDigestSchema = z.object({
  projectId: z.string().min(1).optional(),
  metrics: blocksSchema.optional(),
  as: z.enum(['channel', 'me']).optional(),
  allowPrivateToChannel: z.boolean().optional(),
});
type PreviewDigestBody = z.infer<typeof previewDigestSchema>;

@ApiTags('digests')
@Controller('digests')
export class DigestsController {
  constructor(private readonly digests: DigestsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.digests.list(workspaceId, projectId, user.id);
  }

  /** Xem trước nội dung (chưa lưu) theo quyền xem của người bấm. Khai báo TRƯỚC `:id/run` cho rõ ràng. */
  @Post('preview')
  // Cùng quyền với tạo/sửa/chạy digest (`integration:manage`, phạm vi workspace) — xem trước là bước của chính luồng đó.
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async preview(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(previewDigestSchema)) dto: PreviewDigestBody,
  ) {
    return this.digests.preview(workspaceId, user.id, dto);
  }

  @Post()
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ProjectRef('body', 'projectId')
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDigestSchema)) dto: CreateDigestBody,
  ) {
    return this.digests.create(workspaceId, user.id, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDigestSchema)) dto: UpdateDigestBody,
  ) {
    return this.digests.update(workspaceId, id, dto, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async remove(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.digests.remove(workspaceId, id, user.id);
  }

  @Post(':id/run')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async run(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.digests.run(workspaceId, id, user.id);
  }
}
