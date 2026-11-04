import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import {
  createProjectSubTeamSchema,
  setProjectSubTeamMembersSchema,
  updateProjectSubTeamSchema,
  type CreateProjectSubTeamInput,
  type SetProjectSubTeamMembersInput,
  type UpdateProjectSubTeamInput,
} from './project-subteams.schemas';
import { ProjectSubTeamsService } from './project-subteams.service';

/**
 * Team riêng trong dự án. Quyền tính theo `:projectId` (dự án riêng tư người gọi không thấy → 404): xem cần `project:view`,
 * tạo/sửa/xoá/đổi người cần `project:admin`.
 */
@ApiTags('project-sub-teams')
@Controller('projects/:projectId/sub-teams')
export class ProjectSubTeamsController {
  constructor(private readonly subTeams: ProjectSubTeamsService) {}

  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(@OrganizationId() organizationId: string, @Param('projectId') projectId: string) {
    return this.subTeams.list(organizationId, projectId);
  }

  @Post()
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async create(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createProjectSubTeamSchema)) dto: CreateProjectSubTeamInput,
  ) {
    return this.subTeams.create(organizationId, projectId, dto, user.id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async update(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSubTeamSchema)) dto: UpdateProjectSubTeamInput,
  ) {
    return this.subTeams.update(organizationId, projectId, id, dto, user.id);
  }

  /** Thay toàn bộ người trong team. */
  @Put(':id/members')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async setMembers(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProjectSubTeamMembersSchema)) dto: SetProjectSubTeamMembersInput,
  ) {
    return this.subTeams.setMembers(organizationId, projectId, id, dto.memberIds, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.subTeams.remove(organizationId, projectId, id, user.id);
  }
}
