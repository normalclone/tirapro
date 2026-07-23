import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createIssueSchema, moveIssueSchema, transitionIssueSchema, updateIssueSchema,
  type CreateIssueInput, type MoveIssueInput, type TransitionIssueInput, type UpdateIssueInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { IssuesService } from './issues.service';

@ApiTags('issues')
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async list(
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
      this.ws(user),
      { projectId, statusId, assigneeId, typeId, sprintId, search },
      cursor,
      Math.min(Math.max(Number(limit) || 50, 1), 100),
    );
  }

  @Get(':key')
  async getByKey(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.issues.getByKey(this.ws(user), key.toUpperCase());
  }

  @Permissions(PERMISSIONS.ISSUE_CREATE)
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createIssueSchema)) dto: CreateIssueInput,
  ) {
    return this.issues.create(this.ws(user), user.id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIssueSchema)) dto: UpdateIssueInput,
  ) {
    return this.issues.update(this.ws(user), user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @Post(':id/transition')
  async transition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionIssueSchema)) dto: TransitionIssueInput,
  ) {
    return this.issues.transition(this.ws(user), user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_TRANSITION)
  @Post(':id/move')
  async move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveIssueSchema)) dto: MoveIssueInput,
  ) {
    return this.issues.move(this.ws(user), user.id, id, dto);
  }

  @Permissions(PERMISSIONS.ISSUE_DELETE)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.softDelete(this.ws(user), user.id, id);
  }
}
