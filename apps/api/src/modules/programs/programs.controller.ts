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
  setProjectProgramsSchema,
  type CreateProgramInput,
  type UpdateProgramInput,
  type SetProjectProgramsInput,
} from './programs.schemas';

/**
 * Nhóm dự án là của RIÊNG từng người: mọi route chỉ động tới nhóm của người gọi (nhóm của người khác → 404). Mọi thành viên
 * tạo/sửa/xoá được nhóm của mình, nên chỉ cần `organization:view` (không còn `program:manage`).
 */
@ApiTags('programs')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  /** Nhóm của tôi. */
  @Get()
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async list(@OrganizationId() organizationId: string, @CurrentUser() user: AuthUser) {
    return this.programs.list(organizationId, user.id);
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
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProgramSchema)) dto: CreateProgramInput,
  ) {
    return this.programs.create(organizationId, dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProgramSchema)) dto: UpdateProgramInput,
  ) {
    return this.programs.update(organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.programs.remove(organizationId, id, user.id);
  }
}

/**
 * Nhóm của người gọi cho MỘT dự án: bất kỳ dự án nào người gọi xem được (guard tính theo `:id`, dự án riêng tư không thấy →
 * 404), không cần quyền quản trị — đây là cách người đó tự xếp dự án, không đổi gì với dự án hay người khác.
 */
@ApiTags('programs')
@Controller('projects')
export class ProjectProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Put(':id/programs')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
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
