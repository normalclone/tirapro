import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { PlanningService } from './planning.service';
import {
  createBaselineSchema,
  createDependencySchema,
  createMilestoneSchema,
  updateMilestoneSchema,
  type CreateBaselineInput,
  type CreateDependencyInput,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from './planning.schemas';

/**
 * Lịch trình nâng cao của một dự án: phụ thuộc, cột mốc, kế hoạch gốc, đường găng.
 * `:projectId` nằm ở params nên PermissionsGuard tự giải quyền theo phạm vi dự án.
 */
@ApiTags('planning')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  // ── phụ thuộc ──

  @Get(':projectId/dependencies')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listDependencies(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.planning.listDependencies(workspaceId, projectId);
  }

  @Post(':projectId/dependencies')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createDependency(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createDependencySchema)) dto: CreateDependencyInput,
  ) {
    return this.planning.createDependency(workspaceId, projectId, dto);
  }

  @Delete(':projectId/dependencies/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async removeDependency(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.removeDependency(workspaceId, projectId, id);
  }

  // ── cột mốc ──

  @Get(':projectId/milestones')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listMilestones(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.planning.listMilestones(workspaceId, projectId);
  }

  @Post(':projectId/milestones')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createMilestone(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createMilestoneSchema)) dto: CreateMilestoneInput,
  ) {
    return this.planning.createMilestone(workspaceId, projectId, dto);
  }

  @Put(':projectId/milestones/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async updateMilestone(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) dto: UpdateMilestoneInput,
  ) {
    return this.planning.updateMilestone(workspaceId, projectId, id, dto);
  }

  @Delete(':projectId/milestones/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async removeMilestone(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.removeMilestone(workspaceId, projectId, id);
  }

  // ── kế hoạch gốc ──

  @Get(':projectId/baselines')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listBaselines(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.planning.listBaselines(workspaceId, projectId);
  }

  @Post(':projectId/baselines')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createBaseline(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createBaselineSchema)) dto: CreateBaselineInput,
  ) {
    return this.planning.createBaseline(workspaceId, projectId, dto, user.id);
  }

  @Get(':projectId/baselines/:id')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async getBaseline(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.getBaseline(workspaceId, projectId, id);
  }

  // ── lịch trình / đường găng ──

  @Get(':projectId/schedule')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async schedule(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.planning.schedule(workspaceId, projectId);
  }
}
