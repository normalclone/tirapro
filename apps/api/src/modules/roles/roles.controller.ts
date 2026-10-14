import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RoleScope } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';
import { createRoleSchema, updateRoleSchema, type CreateRoleInput, type UpdateRoleInput } from './roles.schemas';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Danh mục vai trò (hệ thống + custom của workspace). Mọi thành viên xem được. */
  @Get()
  async list(@WorkspaceId() workspaceId: string, @Query('scope') scope?: RoleScope) {
    return this.roles.list(workspaceId, scope);
  }

  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async create(@WorkspaceId() workspaceId: string, @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleInput) {
    return this.roles.create(workspaceId, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleInput,
  ) {
    return this.roles.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.roles.remove(workspaceId, id);
  }
}
