import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { setProjectTeamSchema, type SetProjectTeamInput } from './project-teams.schemas';
import { ProjectTeamsService } from './project-teams.service';

/**
 * Team của tổ chức gắn vào dự án. Quyền theo `:projectId` (guard tính quyền hiệu lực TẠI dự án đó, dự án riêng tư người gọi không thấy
 * → 404): xem cần `project:view`, gắn/đổi vai trò/gỡ cần `project:admin` (Quản trị dự án hoặc Quản trị chung).
 */
@ApiTags('project-teams')
@Controller('projects/:projectId/teams')
export class ProjectTeamsController {
  constructor(private readonly teams: ProjectTeamsService) {}

  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(@OrganizationId() organizationId: string, @Param('projectId') projectId: string) {
    return this.teams.list(organizationId, projectId);
  }

  /** Gắn team (hoặc đổi vai trò của team đã gắn). Trả danh sách team của dự án sau thay đổi. */
  @Put(':teamId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async link(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(setProjectTeamSchema)) dto: SetProjectTeamInput,
  ) {
    return this.teams.link(organizationId, projectId, teamId, dto.roleIds, user.id);
  }

  /** Gỡ team khỏi dự án (chỉ gỡ phần vai trò nhờ team này). */
  @Delete(':teamId')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  async unlink(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.teams.unlink(organizationId, projectId, teamId, user.id);
  }
}
