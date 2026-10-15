import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
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
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listAllocations(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listAllocationsQuerySchema)) q: ListAllocationsQuery,
  ) {
    return this.resources.listAllocations(workspaceId, q);
  }

  @Post('allocations')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createAllocation(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createAllocationSchema)) dto: CreateAllocationInput,
  ) {
    return this.resources.createAllocation(workspaceId, dto);
  }

  @Put('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateAllocation(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAllocationSchema)) dto: UpdateAllocationInput,
  ) {
    return this.resources.updateAllocation(workspaceId, id, dto);
  }

  @Delete('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteAllocation(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.resources.deleteAllocation(workspaceId, id);
  }

  /* ────────────────────── Nghỉ phép / ngày lễ ────────────────────── */

  @Get('time-off')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listTimeOff(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listTimeOffQuerySchema)) q: ListTimeOffQuery,
  ) {
    return this.resources.listTimeOff(workspaceId, q);
  }

  /** `userId` bỏ trống = ngày lễ áp dụng cho toàn workspace. */
  @Post('time-off')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createTimeOff(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createTimeOffSchema)) dto: CreateTimeOffInput,
  ) {
    return this.resources.createTimeOff(workspaceId, dto);
  }

  @Put('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateTimeOff(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTimeOffSchema)) dto: UpdateTimeOffInput,
  ) {
    return this.resources.updateTimeOff(workspaceId, id, dto);
  }

  @Delete('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteTimeOff(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.resources.deleteTimeOff(workspaceId, id);
  }

  /* ───────────────────────── Tải theo tuần ───────────────────────── */

  /** Bảng nhiệt NGƯỜI × TUẦN: năng lực, khối lượng được giao, giờ đã log, cờ quá tải. */
  @Get('workload')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async workload(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(workloadQuerySchema)) q: WorkloadQuery,
  ) {
    return this.resources.workload(workspaceId, q);
  }
}
