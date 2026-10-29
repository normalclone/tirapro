import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  savedFilterCreateSchema,
  savedFilterUpdateSchema,
  type SavedFilterCreateInput,
  type SavedFilterUpdateInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
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

  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get()
  async list(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string) {
    return this.filters.list(workspaceId, user.id);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Post()
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(savedFilterCreateSchema)) body: CreateSavedFilterBody,
  ) {
    return this.filters.create(workspaceId, user.id, body);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(savedFilterUpdateSchema)) body: UpdateSavedFilterBody,
  ) {
    return this.filters.update(workspaceId, user.id, id, body);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.filters.softDelete(workspaceId, user.id, id);
  }

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @Get(':id/run')
  async run(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.filters.run(workspaceId, user.id, id, { cursor, limit: lim });
  }
}
