import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { GoalsService } from './goals.service';
import {
  createGoalSchema, updateGoalSchema, createKeyResultSchema, updateKeyResultSchema, goalIssuesSchema,
  type CreateGoalInput, type UpdateGoalInput, type CreateKeyResultInput, type UpdateKeyResultInput,
  type GoalIssuesInput,
} from './goals.schemas';

/** MỤC TIÊU / OKR — đọc: workspace:view, ghi: goal:manage. */
@ApiTags('goals')
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('period') period?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.goals.list(this.ws(user), { period, projectId, status, ownerId });
  }

  /** Danh sách kỳ đã dùng (vd "2026-Q3") — dựng bộ chọn kỳ. */
  @Get('periods')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async periods(@CurrentUser() user: AuthUser) {
    return this.goals.periods(this.ws(user));
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goals.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGoalSchema)) dto: CreateGoalInput,
  ) {
    return this.goals.create(this.ws(user), dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGoalSchema)) dto: UpdateGoalInput,
  ) {
    return this.goals.update(this.ws(user), id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goals.remove(this.ws(user), id);
  }

  // ── Key Result lồng trong mục tiêu ──

  @Post(':id/key-results')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async addKeyResult(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createKeyResultSchema)) dto: CreateKeyResultInput,
  ) {
    return this.goals.addKeyResult(this.ws(user), id, dto);
  }

  @Put(':id/key-results/:krId')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async updateKeyResult(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Body(new ZodValidationPipe(updateKeyResultSchema)) dto: UpdateKeyResultInput,
  ) {
    return this.goals.updateKeyResult(this.ws(user), id, krId, dto);
  }

  @Delete(':id/key-results/:krId')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async removeKeyResult(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
  ) {
    return this.goals.removeKeyResult(this.ws(user), id, krId);
  }

  // ── Gắn / gỡ issue (epic) vào mục tiêu ──

  @Post(':id/issues')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async addIssues(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.addIssues(this.ws(user), id, dto.issueIds);
  }

  @Delete(':id/issues')
  @Permissions(PERMISSIONS.GOAL_MANAGE)
  async removeIssues(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.removeIssues(this.ws(user), id, dto.issueIds);
  }
}
