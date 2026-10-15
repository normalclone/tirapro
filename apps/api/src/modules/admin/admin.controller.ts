import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AdminService } from './admin.service';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type UpdateUserInput,
} from './admin.schemas';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';

/** Quản trị tài khoản hệ thống — CHỈ admin hệ thống (isSystemAdmin). */
// Chỉ admin hệ thống: từng handler tự kiểm tra isSystemAdmin (assertSysAdmin), không thuộc quyền RBAC của workspace.
@AuthOnly()
@ApiTags('admin')
@Controller('admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private assertSysAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin)
      throw new ForbiddenAppException('Chỉ admin hệ thống mới được quản trị tài khoản');
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    this.assertSysAdmin(user);
    return this.admin.list(query);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserInput,
  ) {
    this.assertSysAdmin(user);
    return this.admin.create(dto, user.id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
  ) {
    this.assertSysAdmin(user);
    return this.admin.update(id, dto, user.id);
  }

  /** Đặt mật khẩu tạm (trả một lần) + đăng xuất mọi thiết bị. */
  @HttpCode(200)
  @Post(':id/reset-password')
  async resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertSysAdmin(user);
    return this.admin.resetPassword(user.id, id);
  }

  /** Đăng xuất mọi thiết bị của tài khoản. */
  @HttpCode(200)
  @Post(':id/revoke-sessions')
  async revokeSessions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertSysAdmin(user);
    return this.admin.revokeSessions(user.id, id);
  }
}
