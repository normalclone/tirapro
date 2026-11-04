import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProgramsService } from './programs.service';
import {
  createProgramSchema,
  updateProgramSchema,
  setProgramProjectsSchema,
  setProjectProgramsSchema,
  type CreateProgramInput,
  type UpdateProgramInput,
  type SetProgramProjectsInput,
  type SetProjectProgramsInput,
} from './programs.schemas';

@ApiTags('programs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  /** Danh sách chương trình (mọi thành viên xem được — dùng cho bộ lọc & gán dự án). */
  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.programs.list(organizationId, user.id);
  }

  /** Rollup tiến độ toàn danh mục — phải khai báo TRƯỚC ':id' để không bị nuốt route. */
  @Get('rollup')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async rollup(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.programs.rollup(organizationId, user.id);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async get(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.programs.get(organizationId, id, user.id);
  }

  @Post()
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProgramSchema)) dto: CreateProgramInput,
  ) {
    return this.programs.create(organizationId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProgramSchema)) dto: UpdateProgramInput,
  ) {
    return this.programs.update(organizationId, id, dto, user.id);
  }

  /** Đặt lại toàn bộ tập dự án của chương trình. */
  @Put(':id/projects')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async setProjects(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProgramProjectsSchema)) dto: SetProgramProjectsInput,
  ) {
    return this.programs.setProjects(organizationId, id, dto.projectIds, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PROGRAM_MANAGE)
  async remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.programs.remove(organizationId, id);
  }
}

/**
 * Nhóm của MỘT dự án. Khai báo ở module nhóm (dữ liệu là quan hệ Dự án ↔ Nhóm) nhưng nằm dưới `/projects/:id`.
 * Quyền: `project:admin` của CHÍNH dự án (guard tính theo `:id`; quản trị tổ chức có sẵn quyền này ở mọi dự án) — không
 * cần `program:manage`, vì đây là việc của người quản trị dự án, không phải của người quản lý danh mục nhóm.
 */
@ApiTags('programs')
@Controller('projects')
export class ProjectProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Put(':id/programs')
  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'id')
  async setForProject(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setProjectProgramsSchema)) dto: SetProjectProgramsInput,
  ) {
    return this.programs.setForProject(organizationId, id, dto.programIds, user.id);
  }
}
