import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { TriageService } from './triage.service';

const acceptSchema = z.object({
  version: z.number().int().nonnegative(),
  assigneeId: z.string().optional(),
  typeId: z.string().min(1).optional(),
  priorityId: z.string().min(1).nullable().optional(),
  sprintId: z.string().min(1).nullable().optional(),
});
type AcceptInput = z.infer<typeof acceptSchema>;

const declineSchema = z.object({
  version: z.number().int().nonnegative(),
  reason: z.string().trim().max(2000).optional(),
});
type DeclineInput = z.infer<typeof declineSchema>;

const snoozeSchema = z.object({
  version: z.number().int().nonnegative(),
  until: z.string().datetime(),
});
type SnoozeInput = z.infer<typeof snoozeSchema>;

@ApiTags('triage')
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async inbox(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.triage.inbox(
      workspaceId,
      projectId,
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
      user.id,
    );
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('count')
  async count(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.triage.count(workspaceId, projectId, user.id);
  }

  // Duyệt việc mới vào = quyền `issue:triage` (đủ cho cả trường đổi kèm khi Nhận: loại/ưu tiên/sprint/người phụ trách);
  // KHÔNG dùng `issue:edit` + own-only: người báo (Reporter) không tự duyệt việc của mình.
  @Permissions(PERMISSIONS.ISSUE_TRIAGE)
  @ProjectRef('issue', 'issueId')
  @Post(':issueId/accept')
  async accept(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(acceptSchema)) dto: AcceptInput,
  ) {
    return this.triage.accept(workspaceId, user.id, issueId, dto);
  }

  // Duyệt việc mới vào = quyền `issue:triage` (đủ cho cả trường đổi kèm khi Nhận: loại/ưu tiên/sprint/người phụ trách);
  // KHÔNG dùng `issue:edit` + own-only: người báo (Reporter) không tự duyệt việc của mình.
  @Permissions(PERMISSIONS.ISSUE_TRIAGE)
  @ProjectRef('issue', 'issueId')
  @Post(':issueId/decline')
  async decline(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(declineSchema)) dto: DeclineInput,
  ) {
    return this.triage.decline(workspaceId, user.id, issueId, dto);
  }

  // Duyệt việc mới vào = quyền `issue:triage` (đủ cho cả trường đổi kèm khi Nhận: loại/ưu tiên/sprint/người phụ trách);
  // KHÔNG dùng `issue:edit` + own-only: người báo (Reporter) không tự duyệt việc của mình.
  @Permissions(PERMISSIONS.ISSUE_TRIAGE)
  @ProjectRef('issue', 'issueId')
  @Post(':issueId/snooze')
  async snooze(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(snoozeSchema)) dto: SnoozeInput,
  ) {
    return this.triage.snooze(workspaceId, user.id, issueId, dto);
  }
}
