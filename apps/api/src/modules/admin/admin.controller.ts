import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AdminService } from './admin.service';
import { createUserSchema, updateUserSchema, type CreateUserInput, type UpdateUserInput } from './admin.schemas';

/** Quản trị tài khoản hệ thống — CHỈ admin hệ thống (isSystemAdmin). */
@ApiTags('admin')
@Controller('admin/users')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private assertSysAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin) throw new ForbiddenAppException('Chỉ admin hệ thống mới được quản trị tài khoản');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    this.assertSysAdmin(user);
    return this.admin.list();
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserInput) {
    this.assertSysAdmin(user);
    return this.admin.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
  ) {
    this.assertSysAdmin(user);
    return this.admin.update(id, dto);
  }
}
