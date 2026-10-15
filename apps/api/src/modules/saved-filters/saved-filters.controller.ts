import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FilterVisibility } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { SavedFiltersService } from './saved-filters.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';

const visibilitySchema = z.nativeEnum(FilterVisibility);

export const createSavedFilterSchema = z.object({
  name: z.string().min(1, 'Tên bắt buộc').max(120),
  jql: z.string().min(1, 'JQL bắt buộc').max(10_000),
  visibility: visibilitySchema.optional(),
  sharedProjectId: z.string().min(1).optional().nullable(),
});

export const updateSavedFilterSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    jql: z.string().min(1).max(10_000).optional(),
    visibility: visibilitySchema.optional(),
    sharedProjectId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật' });

export type CreateSavedFilterBody = z.infer<typeof createSavedFilterSchema>;
export type UpdateSavedFilterBody = z.infer<typeof updateSavedFilterSchema>;

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
    @Body(new ZodValidationPipe(createSavedFilterSchema)) body: CreateSavedFilterBody,
  ) {
    return this.filters.create(workspaceId, user.id, body);
  }

  @Permissions(PERMISSIONS.FILTER_MANAGE)
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSavedFilterSchema)) body: UpdateSavedFilterBody,
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
