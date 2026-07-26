import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { PlanningService } from './planning.service';
import {
  createBaselineSchema, createDependencySchema, createMilestoneSchema, updateMilestoneSchema,
  type CreateBaselineInput, type CreateDependencyInput, type CreateMilestoneInput, type UpdateMilestoneInput,
} from './planning.schemas';

/**
 * Lịch trình nâng cao của một dự án: phụ thuộc, cột mốc, kế hoạch gốc, đường găng.
 * `:projectId` nằm ở params nên PermissionsGuard tự giải quyền theo phạm vi dự án.
 */
@ApiTags('planning')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ── phụ thuộc ──

  @Get(':projectId/dependencies')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listDependencies(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.planning.listDependencies(this.ws(user), projectId);
  }

  @Post(':projectId/dependencies')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createDependency(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createDependencySchema)) dto: CreateDependencyInput,
  ) {
    return this.planning.createDependency(this.ws(user), projectId, dto);
  }

  @Delete(':projectId/dependencies/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async removeDependency(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.removeDependency(this.ws(user), projectId, id);
  }

  // ── cột mốc ──

  @Get(':projectId/milestones')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listMilestones(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.planning.listMilestones(this.ws(user), projectId);
  }

  @Post(':projectId/milestones')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createMilestone(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createMilestoneSchema)) dto: CreateMilestoneInput,
  ) {
    return this.planning.createMilestone(this.ws(user), projectId, dto);
  }

  @Put(':projectId/milestones/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async updateMilestone(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) dto: UpdateMilestoneInput,
  ) {
    return this.planning.updateMilestone(this.ws(user), projectId, id, dto);
  }

  @Delete(':projectId/milestones/:id')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async removeMilestone(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.removeMilestone(this.ws(user), projectId, id);
  }

  // ── kế hoạch gốc ──

  @Get(':projectId/baselines')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async listBaselines(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.planning.listBaselines(this.ws(user), projectId);
  }

  @Post(':projectId/baselines')
  @Permissions(PERMISSIONS.PLAN_MANAGE)
  async createBaseline(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createBaselineSchema)) dto: CreateBaselineInput,
  ) {
    return this.planning.createBaseline(this.ws(user), projectId, dto, user.id);
  }

  @Get(':projectId/baselines/:id')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async getBaseline(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.planning.getBaseline(this.ws(user), projectId, id);
  }

  // ── lịch trình / đường găng ──

  @Get(':projectId/schedule')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async schedule(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.planning.schedule(this.ws(user), projectId);
  }
}
