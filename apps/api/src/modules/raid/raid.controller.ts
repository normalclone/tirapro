import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RaidService } from './raid.service';
import {
  createRaidSchema, updateRaidSchema,
  type CreateRaidInput, type UpdateRaidInput,
} from './raid.schemas';

/** SỔ RỦI RO RAID — đọc: project:view, ghi: risk:manage. */
@ApiTags('raid')
@Controller('raid')
export class RaidController {
  constructor(private readonly raid: RaidService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  @Get()
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.raid.list(this.ws(user), { kind, status, projectId, ownerId });
  }

  @Get(':id')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.raid.get(this.ws(user), id);
  }

  @Post()
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRaidSchema)) dto: CreateRaidInput,
  ) {
    return this.raid.create(this.ws(user), dto, user.id);
  }

  @Put(':id')
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRaidSchema)) dto: UpdateRaidInput,
  ) {
    return this.raid.update(this.ws(user), id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.RISK_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.raid.remove(this.ws(user), id);
  }
}
