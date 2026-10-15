import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { TeamsService } from './teams.service';
import {
  createTeamSchema,
  updateTeamSchema,
  setTeamMembersSchema,
  assignTeamToProjectSchema,
  type CreateTeamInput,
  type UpdateTeamInput,
  type SetTeamMembersInput,
  type AssignTeamToProjectInput,
} from './teams.schemas';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** Danh sách nhóm của workspace (mọi thành viên xem được — cho gán/lọc issue). */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@WorkspaceId() workspaceId: string) {
    return this.teams.list(workspaceId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.teams.get(workspaceId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTeamSchema)) dto: CreateTeamInput,
  ) {
    return this.teams.create(workspaceId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) dto: UpdateTeamInput,
  ) {
    return this.teams.update(workspaceId, id, dto, user.id);
  }

  @Put(':id/members')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async setMembers(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTeamMembersSchema)) dto: SetTeamMembersInput,
  ) {
    return this.teams.setMembers(workspaceId, id, dto.memberIds);
  }

  @Post(':id/assign-project')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async assignProject(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTeamToProjectSchema)) dto: AssignTeamToProjectInput,
  ) {
    return this.teams.assignToProject(workspaceId, id, dto.projectId, dto.roleIds);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.teams.remove(workspaceId, id);
  }
}
