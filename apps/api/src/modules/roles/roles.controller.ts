import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RoleScope } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RolesService } from './roles.service';
import { createRoleSchema, updateRoleSchema, type CreateRoleInput, type UpdateRoleInput } from './roles.schemas';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Danh mục vai trò (hệ thống + custom của workspace). Mọi thành viên xem được. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('scope') scope?: RoleScope) {
    return this.roles.list(this.ws(user), scope);
  }

  @Post()
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleInput) {
    return this.roles.create(this.ws(user), dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleInput,
  ) {
    return this.roles.update(this.ws(user), id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.MEMBER_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.roles.remove(this.ws(user), id);
  }
}
