import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { DigestsService } from './digests.service';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';

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

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.digests.list(workspaceId, projectId);
  }

  @Post()
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
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
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDigestSchema)) dto: UpdateDigestBody,
  ) {
    return this.digests.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.digests.remove(workspaceId, id);
  }

  @Post(':id/run')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async run(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.digests.run(workspaceId, id);
  }
}
