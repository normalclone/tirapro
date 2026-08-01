import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ResourcesService } from './resources.service';
import {
  createAllocationSchema, updateAllocationSchema, listAllocationsQuerySchema,
  createTimeOffSchema, updateTimeOffSchema, listTimeOffQuerySchema, workloadQuerySchema,
  type CreateAllocationInput, type UpdateAllocationInput, type ListAllocationsQuery,
  type CreateTimeOffInput, type UpdateTimeOffInput, type ListTimeOffQuery, type WorkloadQuery,
} from './resources.schemas';

@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /* ───────────────────────── Phân bổ ───────────────────────── */

  @Get('allocations')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listAllocations(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listAllocationsQuerySchema)) q: ListAllocationsQuery,
  ) {
    return this.resources.listAllocations(this.ws(user), q);
  }

  @Post('allocations')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createAllocation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAllocationSchema)) dto: CreateAllocationInput,
  ) {
    return this.resources.createAllocation(this.ws(user), dto);
  }

  @Put('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateAllocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAllocationSchema)) dto: UpdateAllocationInput,
  ) {
    return this.resources.updateAllocation(this.ws(user), id, dto);
  }

  @Delete('allocations/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteAllocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.resources.deleteAllocation(this.ws(user), id);
  }

  /* ────────────────────── Nghỉ phép / ngày lễ ────────────────────── */

  @Get('time-off')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async listTimeOff(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listTimeOffQuerySchema)) q: ListTimeOffQuery,
  ) {
    return this.resources.listTimeOff(this.ws(user), q);
  }

  /** `userId` bỏ trống = ngày lễ áp dụng cho toàn workspace. */
  @Post('time-off')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async createTimeOff(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTimeOffSchema)) dto: CreateTimeOffInput,
  ) {
    return this.resources.createTimeOff(this.ws(user), dto);
  }

  @Put('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async updateTimeOff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTimeOffSchema)) dto: UpdateTimeOffInput,
  ) {
    return this.resources.updateTimeOff(this.ws(user), id, dto);
  }

  @Delete('time-off/:id')
  @Permissions(PERMISSIONS.RESOURCE_MANAGE)
  async deleteTimeOff(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.resources.deleteTimeOff(this.ws(user), id);
  }

  /* ───────────────────────── Tải theo tuần ───────────────────────── */

  /** Bảng nhiệt NGƯỜI × TUẦN: năng lực, khối lượng được giao, giờ đã log, cờ quá tải. */
  @Get('workload')
  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  async workload(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(workloadQuerySchema)) q: WorkloadQuery,
  ) {
    return this.resources.workload(this.ws(user), q);
  }
}
