import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  bulkUpdateIssuesSchema,
  createIssueSchema,
  moveIssueSchema,
  rankIssueSchema,
  transitionIssueSchema,
  updateIssueSchema,
  type BulkUpdateIssuesInput,
  type CreateIssueInput,
  type MoveIssueInput,
  type RankIssueInput,
  type TransitionIssueInput,
  type UpdateIssueInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { IssuesService } from './issues.service';

@ApiTags('issues')
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('statusId') statusId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('typeId') typeId?: string,
    @Query('sprintId') sprintId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.issues.list(
      organizationId,
      { projectId, statusId, assigneeId, typeId, sprintId, search },
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
      user.id,
    );
  }

  /**
   * Không có `@ProjectRef` (dự án suy ra từ mã, không phải id): người ngoài dự án riêng tư nhận 404 do
   * `getByKey` lọc theo `viewerId` — cùng thông điệp với mã không tồn tại.
   */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get(':key')
  async getByKey(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
  ) {
    return this.issues.getByKey(organizationId, key.toUpperCase(), user.id);
  }

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @ProjectRef('body', 'projectId')
  @Post()
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIssueSchema)) dto: CreateIssueInput,
  ) {
    return this.issues.create(organizationId, user.id, dto);
  }

  // Khai báo TRƯỚC `PATCH :id` để "bulk" không bị coi là id.
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('body', 'projectId')
  @Patch('bulk')
  async bulkUpdate(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bulkUpdateIssuesSchema)) dto: BulkUpdateIssuesInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    return this.issues.bulkUpdate(organizationId, user.id, dto, ownOnly);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'id')
  @Patch(':id')
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) dto: UpdateIssueInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    return this.issues.update(organizationId, user.id, id, dto, undefined, ownOnly);
  }

  /** "Tính lại theo công thức": bỏ điểm chỉnh tay. Chỉ Quản trị dự án (SA qua guard luôn được). */
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('issue', 'id')
  @Post(':id/points/reset')
  async resetPoints(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.issues.resetPoints(organizationId, user.id, id);
  }

  /** Bước chuyển khả dụng theo quy trình của loại việc này (+ gợi ý quay về khi đang Pending). */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'id')
  @Get(':id/transitions')
  async transitions(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.issues.getTransitions(organizationId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @ProjectRef('issue', 'id')
  @Post(':id/transition')
  async transition(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionIssueSchema)) dto: TransitionIssueInput,
    @OwnOnly(PERMISSIONS.ISSUE_TRANSITION) ownOnly: boolean,
  ) {
    return this.issues.transition(organizationId, user.id, id, dto, undefined, ownOnly);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @ProjectRef('issue', 'id')
  @Post(':id/move')
  async move(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveIssueSchema)) dto: MoveIssueInput,
    @OwnOnly(PERMISSIONS.ISSUE_TRANSITION) ownOnly: boolean,
  ) {
    return this.issues.move(organizationId, user.id, id, dto, ownOnly);
  }

  /**
   * Xếp lại thứ tự / đổi sprint (không đổi trạng thái). Dùng cho Backlog: Product Owner có `backlog:manage` + `issue:edit`
   * nhưng không có `issue:transition` nên không gọi được `move`. Cùng `IssuesService.move()` bên dưới.
   */
  @Permissions(PERMISSIONS.BACKLOG_MANAGE, PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'id')
  @Post(':id/rank')
  async rank(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rankIssueSchema)) dto: RankIssueInput,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    return this.issues.move(organizationId, user.id, id, dto, ownOnly);
  }

  /** Người báo/tạo tự thu hồi việc của mình trong 10 phút đầu (không cần `issue:delete`); server quyết điều kiện. */
  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @ProjectRef('issue', 'id')
  @Post(':id/retract')
  async retract(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.issues.retract(organizationId, user.id, id);
  }

  @Permissions(PERMISSIONS.ISSUE_DELETE)
  @ProjectRef('issue', 'id')
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.issues.softDelete(organizationId, user.id, id);
  }
}
