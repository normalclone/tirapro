import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ProgramsService } from './programs.service';
import {
  createProgramSchema, updateProgramSchema, setProgramProjectsSchema,
  type CreateProgramInput, type UpdateProgramInput, type SetProgramProjectsInput,
} from './programs.schemas';

@ApiTags('programs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Danh sách chương trình (mọi thành viên xem được — dùng cho bộ lọc & gán dự án). */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@CurrentUser() user: AuthUser) {
    return this.programs.list(this.ws(user));
  }

  /** Rollup tiến độ toàn danh mục — phải khai báo TRƯỚC ':id' để không bị nuốt route. */
  @Get('rollup')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async rollup(@CurrentUser() user: AuthUser) {
    return this.programs.rollup(this.ws(user));
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProgramSchema)) dto: CreateProgramInput,
  ) {
    return this.programs.create(this.ws(user), dto);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProgramSchema)) dto: UpdateProgramInput,
  ) {
    return this.programs.update(this.ws(user), id, dto);
  }

  /** Đặt lại toàn bộ tập dự án của chương trình. */
  @Put(':id/projects')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async setProjects(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProgramProjectsSchema)) dto: SetProgramProjectsInput,
  ) {
    return this.programs.setProjects(this.ws(user), id, dto.projectIds);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.remove(this.ws(user), id);
  }
}
