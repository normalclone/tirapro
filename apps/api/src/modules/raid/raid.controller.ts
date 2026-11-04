import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions, PermissionsAnyOf } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RaidService } from './raid.service';
import {
  createRaidSchema,
  updateRaidSchema,
  type CreateRaidInput,
  type UpdateRaidInput,
} from './raid.schemas';

/** SỔ RỦI RO RAID — đọc: project:view, ghi: risk:manage. */
@ApiTags('raid')
@Controller('raid')
export class RaidController {
  constructor(private readonly raid: RaidService) {}

  @ProjectRef('query', 'projectId')
  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.raid.list(organizationId, { kind, status, projectId, ownerId }, user.id);
  }

  @ProjectRef('raid', 'id')
  @Get(':id')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async get(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.raid.get(organizationId, id, user.id);
  }

  @Post()
  @PermissionsAnyOf(PERMISSIONS.RISK_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRaidSchema)) dto: CreateRaidInput,
  ) {
    return this.raid.create(organizationId, dto, user.id);
  }

  @ProjectRef('raid', 'id')
  @Put(':id')
  @PermissionsAnyOf(PERMISSIONS.RISK_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRaidSchema)) dto: UpdateRaidInput,
  ) {
    return this.raid.update(organizationId, id, dto, user);
  }

  @ProjectRef('raid', 'id')
  @Delete(':id')
  @PermissionsAnyOf(PERMISSIONS.RISK_MANAGE, PERMISSIONS.PROJECT_ADMIN)
  async remove(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.raid.remove(organizationId, id, user.id);
  }
}
