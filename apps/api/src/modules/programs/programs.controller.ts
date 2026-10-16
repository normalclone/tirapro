import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProgramsService } from './programs.service';
import {
  createProgramSchema,
  updateProgramSchema,
  setProgramProjectsSchema,
  type CreateProgramInput,
  type UpdateProgramInput,
  type SetProgramProjectsInput,
} from './programs.schemas';

@ApiTags('programs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  /** Danh sách chương trình (mọi thành viên xem được — dùng cho bộ lọc & gán dự án). */
  @Get()
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async list(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.programs.list(workspaceId, user.id);
  }

  /** Rollup tiến độ toàn danh mục — phải khai báo TRƯỚC ':id' để không bị nuốt route. */
  @Get('rollup')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async rollup(@WorkspaceId() workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.programs.rollup(workspaceId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async get(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.programs.get(workspaceId, id, user.id);
  }

  @Post()
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProgramSchema)) dto: CreateProgramInput,
  ) {
    return this.programs.create(workspaceId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProgramSchema)) dto: UpdateProgramInput,
  ) {
    return this.programs.update(workspaceId, id, dto, user.id);
  }

  /** Đặt lại toàn bộ tập dự án của chương trình. */
  @Put(':id/projects')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async setProjects(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProgramProjectsSchema)) dto: SetProgramProjectsInput,
  ) {
    return this.programs.setProjects(workspaceId, id, dto.projectIds, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.programs.remove(workspaceId, id);
  }
}
