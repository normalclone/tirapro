import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ProjectRolesService } from './project-roles.service';
import {
  createProjectRoleSchema,
  updateProjectRoleSchema,
  type CreateProjectRoleInput,
  type UpdateProjectRoleInput,
} from './roles.schemas';

/**
 * Vai trò RIÊNG của dự án. Xem: mọi người xem được dự án (để chọn vai trò khi thêm người). Tạo/sửa/xoá: `project:admin` của CHÍNH dự
 * án (`@ProjectRef('param','projectId')` — guard kiểm dự án thuộc tổ chức, người gọi thấy được và có quyền ở dự án đó).
 */
@ApiTags('roles')
@Controller('projects/:projectId/roles')
export class ProjectRolesController {
  constructor(private readonly roles: ProjectRolesService) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get()
  async list(@OrganizationId() organizationId: string, @Param('projectId') projectId: string) {
    return this.roles.list(organizationId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createProjectRoleSchema)) dto: CreateProjectRoleInput,
  ) {
    return this.roles.create(organizationId, projectId, dto, user.id);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Patch(':roleId')
  async update(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateProjectRoleSchema)) dto: UpdateProjectRoleInput,
  ) {
    return this.roles.update(organizationId, projectId, roleId, dto, user.id);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Delete(':roleId')
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.roles.remove(organizationId, projectId, roleId, user.id);
  }
}
