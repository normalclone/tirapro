import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ResourcesService } from './resources.service';
import {
  createAllocationSchema,
  updateAllocationSchema,
  listAllocationsQuerySchema,
  createTimeOffSchema,
  updateTimeOffSchema,
  listTimeOffQuerySchema,
  workloadQuerySchema,
  type CreateAllocationInput,
  type UpdateAllocationInput,
  type ListAllocationsQuery,
  type CreateTimeOffInput,
  type UpdateTimeOffInput,
  type ListTimeOffQuery,
  type WorkloadQuery,
} from './resources.schemas';

@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  /* ───────────────────────── Phân bổ ───────────────────────── */

  @Get('allocations')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async listAllocations(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listAllocationsQuerySchema)) q: ListAllocationsQuery,
  ) {
    return this.resources.listAllocations(organizationId, q, user.id);
  }

  @Post('allocations')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createAllocation(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAllocationSchema)) dto: CreateAllocationInput,
  ) {
    return this.resources.createAllocation(organizationId, dto, user.id);
  }

  @Put('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateAllocation(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAllocationSchema)) dto: UpdateAllocationInput,
  ) {
    return this.resources.updateAllocation(organizationId, id, dto, user.id);
  }

  @Delete('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteAllocation(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.resources.deleteAllocation(organizationId, id, user.id);
  }

  /* ────────────────────── Nghỉ phép / ngày lễ ────────────────────── */

  @Get('time-off')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async listTimeOff(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listTimeOffQuerySchema)) q: ListTimeOffQuery,
  ) {
    return this.resources.listTimeOff(organizationId, q);
  }

  /** `userId` bỏ trống = ngày lễ áp dụng cho toàn organization. */
  @Post('time-off')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createTimeOff(
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createTimeOffSchema)) dto: CreateTimeOffInput,
  ) {
    return this.resources.createTimeOff(organizationId, dto);
  }

  @Put('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateTimeOff(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTimeOffSchema)) dto: UpdateTimeOffInput,
  ) {
    return this.resources.updateTimeOff(organizationId, id, dto);
  }

  @Delete('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteTimeOff(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.resources.deleteTimeOff(organizationId, id);
  }

  /* ───────────────────────── Tải theo tuần ───────────────────────── */

  /** Bảng nhiệt NGƯỜI × TUẦN: năng lực, khối lượng được giao, giờ đã log, cờ quá tải. */
  @Get('workload')
  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  async workload(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(workloadQuerySchema)) q: WorkloadQuery,
  ) {
    return this.resources.workload(organizationId, q, user.id);
  }
}
