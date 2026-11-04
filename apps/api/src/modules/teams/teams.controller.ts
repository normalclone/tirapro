import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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

  /** Danh sách nhóm của tổ chức (mọi thành viên xem được — cho gán/lọc issue). */
  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(@OrganizationId() organizationId: string) {
    return this.teams.list(organizationId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async get(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.teams.get(organizationId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTeamSchema)) dto: CreateTeamInput,
  ) {
    return this.teams.create(organizationId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) dto: UpdateTeamInput,
  ) {
    return this.teams.update(organizationId, id, dto, user.id);
  }

  @Put(':id/members')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async setMembers(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setTeamMembersSchema)) dto: SetTeamMembersInput,
  ) {
    return this.teams.setMembers(organizationId, id, dto.memberIds, user.id);
  }

  @Post(':id/assign-project')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async assignProject(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTeamToProjectSchema)) dto: AssignTeamToProjectInput,
  ) {
    return this.teams.assignToProject(organizationId, id, dto.projectId, dto.roleIds, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.TEAM_MANAGE)
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.teams.remove(organizationId, id, user.id);
  }
}
