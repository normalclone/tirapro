import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions, PermissionsAnyOf } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GoalsService } from './goals.service';
import {
  createGoalSchema,
  updateGoalSchema,
  createKeyResultSchema,
  createCheckInSchema,
  updateKeyResultSchema,
  goalIssuesSchema,
  type CreateGoalInput,
  type UpdateGoalInput,
  type CreateKeyResultInput,
  type CreateCheckInInput,
  type UpdateKeyResultInput,
  type GoalIssuesInput,
} from './goals.schemas';

/**
 * MỤC TIÊU / OKR (luôn thuộc một dự án) — đọc: organization:view; ghi: `goal:manage` HOẶC quản trị chính dự án của mục tiêu
 * (`project:admin`, tính theo dự án của hàng ở `:id` / `body.projectId` khi tạo — không tin body cho hàng đã có).
 */
@ApiTags('goals')
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @ProjectRef('query', 'projectId')
  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('period') period?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.goals.list(organizationId, { period, projectId, status, ownerId }, user.id);
  }

  /** Danh sách kỳ đã dùng (vd "2026-Q3") — dựng bộ chọn kỳ. */
  @Get('periods')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async periods(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.goals.periods(organizationId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async get(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.goals.get(organizationId, id, user.id);
  }

  /** Lịch sử tiến độ theo ngày (đường KR + trung bình mục tiêu + mốc kỳ vọng). `days` tối đa 365. */
  @Get(':id/progress-history')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async progressHistory(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const n = days === undefined ? undefined : Number.parseInt(days, 10);
    return this.goals.progressHistory(
      organizationId,
      id,
      user.id,
      n !== undefined && Number.isFinite(n) ? n : undefined,
    );
  }

  /** Tạo: `goal:manage` HOẶC quản trị CHÍNH dự án trong `body.projectId` (guard tính quyền ở dự án đó). */
  @Post()
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGoalSchema)) dto: CreateGoalInput,
  ) {
    return this.goals.create(organizationId, dto, user.id);
  }

  @Put(':id')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateGoalSchema)) dto: UpdateGoalInput,
  ) {
    return this.goals.update(organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.goals.remove(organizationId, id, user.id);
  }

  // ── Key Result lồng trong mục tiêu ──

  @Post(':id/key-results')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async addKeyResult(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createKeyResultSchema)) dto: CreateKeyResultInput,
  ) {
    return this.goals.addKeyResult(organizationId, id, dto, user.id);
  }

  @Put(':id/key-results/:krId')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async updateKeyResult(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Body(new ZodValidationPipe(updateKeyResultSchema)) dto: UpdateKeyResultInput,
  ) {
    return this.goals.updateKeyResult(organizationId, id, krId, dto, user.id);
  }

  @Delete(':id/key-results/:krId')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async removeKeyResult(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
  ) {
    return this.goals.removeKeyResult(organizationId, id, krId, user.id);
  }

  /** Check-in tay (có ghi chú) cho KR nhập tay — ghi lịch sử + cập nhật giá trị hiện tại. */
  @Post(':id/key-results/:krId/check-ins')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async addCheckIn(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Body(new ZodValidationPipe(createCheckInSchema)) dto: CreateCheckInInput,
  ) {
    return this.goals.addCheckIn(organizationId, id, krId, dto, user.id);
  }

  /** Lịch sử check-in của một KR, mới nhất trước (mặc định 30, tối đa 50). */
  @Get(':id/key-results/:krId/check-ins')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async listCheckIns(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('krId') krId: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return this.goals.listCheckIns(
      organizationId,
      id,
      krId,
      Number.isFinite(n) ? n : undefined,
      user.id,
    );
  }

  // ── Gắn / gỡ issue (epic) vào mục tiêu ──

  @Post(':id/issues')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async addIssues(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.addIssues(organizationId, id, dto.issueIds, user.id);
  }

  @Delete(':id/issues')
  @ProjectRef('objective', 'id')
  @PermissionsAnyOf(PERMISSIONS.GOAL_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async removeIssues(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(goalIssuesSchema)) dto: GoalIssuesInput,
  ) {
    return this.goals.removeIssues(organizationId, id, dto.issueIds, user.id);
  }
}
