import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { BoardsService } from './boards.service';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('projectId') projectId: string) {
    return this.boards.listForProject(workspaceId, projectId);
  }

  @ProjectRef('board', 'id')
  @Get(':id')
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.boards.get(workspaceId, id);
  }
}
