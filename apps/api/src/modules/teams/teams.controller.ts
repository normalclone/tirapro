import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { TeamsService } from './teams.service';
import {
  createTeamSchema, updateTeamSchema, setTeamMembersSchema, assignTeamToProjectSchema,
  type CreateTeamInput, type UpdateTeamInput, type SetTeamMembersInput, type AssignTeamToProjectInput,
} from './teams.schemas';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Danh sách nhóm của workspace (mọi thành viên xem được — cho gán/lọc issue). */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@CurrentUser() user: AuthUser) {
    return this.teams.list(this.ws(user));
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teams.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTeamSchema)) dto: CreateTeamInput,
  ) {
    return this.teams.create(this.ws(user), dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) dto: UpdateTeamInput,
  ) {
    return this.teams.update(this.ws(user), id, dto, user.id);
  }

  @Put(':id/members')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async setMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTeamMembersSchema)) dto: SetTeamMembersInput,
  ) {
    return this.teams.setMembers(this.ws(user), id, dto.memberIds);
  }

  @Post(':id/assign-project')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async assignProject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTeamToProjectSchema)) dto: AssignTeamToProjectInput,
  ) {
    return this.teams.assignToProject(this.ws(user), id, dto.projectId, dto.roleIds);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.teams.remove(this.ws(user), id);
  }
}
