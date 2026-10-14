import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { setBoardColumnsSchema, updateBoardSchema, type SetBoardColumnsInput, type UpdateBoardInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { BoardsService } from './boards.service';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('projectId') projectId: string) {
    return this.boards.listForProject(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('board', 'id')
  @Get(':id')
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.boards.get(workspaceId, id);
  }

  /** Việc của board — có bộ lọc JQL của board thì đã áp sẵn. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('board', 'id')
  @Get(':id/issues')
  async issues(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
    return this.boards.listIssues(workspaceId, user.id, id, cursor, lim);
  }

  @Permissions(PERMISSIONS.BOARD_MANAGE)
  @ProjectRef('board', 'id')
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBoardSchema)) dto: UpdateBoardInput,
  ) {
    return this.boards.update(workspaceId, id, dto);
  }

  @Permissions(PERMISSIONS.BOARD_MANAGE)
  @ProjectRef('board', 'id')
  @Put(':id/columns')
  async setColumns(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setBoardColumnsSchema)) dto: SetBoardColumnsInput,
  ) {
    return this.boards.setColumns(workspaceId, id, dto);
  }
}
