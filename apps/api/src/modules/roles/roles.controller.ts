import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RoleScope } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';
import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from './roles.schemas';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Danh mục vai trò (hệ thống + custom của tổ chức). Mọi thành viên xem được. */
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  @Get()
  async list(@OrganizationId() organizationId: string, @Query('scope') scope?: RoleScope) {
    return this.roles.list(organizationId, scope);
  }

  /** Mẫu vai trò dùng chung: chỉ Quản trị (khớp giao diện Quản trị › Vai trò & quyền). */
  @Post()
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async create(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleInput,
  ) {
    return this.roles.create(organizationId, dto, user.id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async update(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleInput,
  ) {
    return this.roles.update(organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.roles.remove(organizationId, id, user.id);
  }
}
