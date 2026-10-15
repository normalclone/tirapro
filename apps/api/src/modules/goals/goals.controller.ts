import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GoalsService } from './goals.service';
import {
  createGoalSchema,
  updateGoalSchema,
  createKeyResultSchema,
  updateKeyResultSchema,
  goalIssuesSchema,
  type CreateGoalInput,
  type UpdateGoalInput,
  type CreateKeyResultInput,
  type UpdateKeyResultInput,
  type GoalIssuesInput,
} from './goals.schemas';

/** MỤC TIÊU / OKR — đọc: workspace:view, ghi: goal:manage. */
@ApiTags('goals')
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @ProjectRef('query', 'projectId')
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(
    @WorkspaceId() workspaceId: string,
    @Query('period') period?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.goals.list(workspaceId, { period, projectId, status, ownerId });
  }

  /** Danh sách kỳ đã dùng (vd "2026-Q3") — dựng bộ chọn kỳ. */
  @Get('periods')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async periods(@WorkspaceId() workspaceId: string) {
    return this.goals.periods(workspaceId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.goals.get(workspaceId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createGoalSchema)) dto: CreateGoalInput,
  ) {
    return this.goals.create(workspaceId, dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGoalSchema)) dto: UpdateGoalInput,
  ) {
    return this.goals.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.goals.remove(workspaceId, id);
  }

  // ── Key Result lồng trong mục tiêu ──

  @Post(':id/key-results')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async addKeyResult(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createKeyResultSchema)) dto: CreateKeyResultInput,
  ) {
    return this.goals.addKeyResult(workspaceId, id, dto);
  }

  @Put(':id/key-results/:krId')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async updateKeyResult(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Body(new ZodValidationPipe(updateKeyResultSchema)) dto: UpdateKeyResultInput,
  ) {
    return this.goals.updateKeyResult(workspaceId, id, krId, dto);
  }

  @Delete(':id/key-results/:krId')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async removeKeyResult(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Param('krId') krId: string,
  ) {
    return this.goals.removeKeyResult(workspaceId, id, krId);
  }

  // ── Gắn / gỡ issue (epic) vào mục tiêu ──

  @Post(':id/issues')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async addIssues(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.addIssues(workspaceId, id, dto.issueIds);
  }

  @Delete(':id/issues')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async removeIssues(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.removeIssues(workspaceId, id, dto.issueIds);
  }
}
