import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  filterAudienceSchema,
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
  type FilterAudienceInput,
  type SavedFilterCreateInput,
  type SavedFilterUpdateInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { SavedFiltersService } from './saved-filters.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';

export type CreateSavedFilterBody = SavedFilterCreateInput;
export type UpdateSavedFilterBody = SavedFilterUpdateInput;

@ApiTags('saved-filters')
@Controller('filters')
export class SavedFiltersController {
  constructor(private readonly filters: SavedFiltersService) {}

  @Permissions(PERMISSIONS.ORGANIZATION_VIEW)
  @Get()
  async list(@CurrentUser() user: AuthUser, @OrganizationId() organizationId: string) {
    return this.filters.list(organizationId, user.id);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Post()
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(savedFilterCreateSchema)) body: CreateSavedFilterBody,
  ) {
    return this.filters.create(organizationId, user.id, body);
  }

  /** Số người xem được một bản chia sẻ CHƯA lưu (hộp Chia sẻ). Tính theo người gọi: dự án họ không xem được bị bỏ qua. */
  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Post('audience')
  async audience(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(filterAudienceSchema)) body: FilterAudienceInput,
  ) {
    return this.filters.audience(organizationId, user.id, body);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Patch(':id')
  async update(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(savedFilterUpdateSchema)) body: UpdateSavedFilterBody,
  ) {
    return this.filters.update(organizationId, user.id, id, body);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.filters.softDelete(organizationId, user.id, id);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get(':id/run')
  async run(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.filters.run(organizationId, user.id, id, { cursor, limit: lim });
  }
}
