import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { DigestsService } from './digests.service';

const scheduleEnum = z.enum(['DAILY', 'WEEKLY', 'SPRINT_END', 'MANUAL']);

const createDigestSchema = z.object({
  name: z.string().trim().min(1, 'Tên không được để trống').max(120),
  schedule: scheduleEnum.optional(),
  projectId: z.string().optional(),
  channelId: z.string().optional(),
  metrics: z.array(z.string()).optional(),
  recipients: z.array(z.string()).optional(),
});
type CreateDigestBody = z.infer<typeof createDigestSchema>;

const updateDigestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  schedule: scheduleEnum.optional(),
  isEnabled: z.boolean().optional(),
  channelId: z.string().nullable().optional(),
  metrics: z.array(z.string()).optional(),
});
type UpdateDigestBody = z.infer<typeof updateDigestSchema>;

@ApiTags('digests')
@Controller('digests')
export class DigestsController {
  constructor(private readonly digests: DigestsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.digests.list(this.ws(user), projectId);
  }

  @Post()
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDigestSchema)) dto: CreateDigestBody,
  ) {
    return this.digests.create(this.ws(user), user.id, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDigestSchema)) dto: UpdateDigestBody,
  ) {
    return this.digests.update(this.ws(user), id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.digests.remove(this.ws(user), id);
  }

  @Post(':id/run')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.digests.run(this.ws(user), id);
  }
}
