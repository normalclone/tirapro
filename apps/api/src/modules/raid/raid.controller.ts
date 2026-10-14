import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RaidService } from './raid.service';
import {
  createRaidSchema, updateRaidSchema,
  type CreateRaidInput, type UpdateRaidInput,
} from './raid.schemas';

/** SỔ RỦI RO RAID — đọc: project:view, ghi: risk:manage. */
@ApiTags('raid')
@Controller('raid')
export class RaidController {
  constructor(private readonly raid: RaidService) {}

  @ProjectRef('query', 'projectId')
  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(
    @WorkspaceId() workspaceId: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.raid.list(workspaceId, { kind, status, projectId, ownerId });
  }

  @ProjectRef('raid', 'id')
  @Get(':id')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.raid.get(workspaceId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRaidSchema)) dto: CreateRaidInput,
  ) {
    return this.raid.create(workspaceId, dto, user.id);
  }

  @ProjectRef('raid', 'id')
  @Put(':id')
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRaidSchema)) dto: UpdateRaidInput,
  ) {
    return this.raid.update(workspaceId, id, dto);
  }

  @ProjectRef('raid', 'id')
  @Delete(':id')
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.raid.remove(workspaceId, id);
  }
}
