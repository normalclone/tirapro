import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { FilterVisibility } from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { SavedFiltersService } from './saved-filters.service';

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

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.filters.list(this.ws(user), user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSavedFilterSchema)) body: CreateSavedFilterBody,
  ) {
    return this.filters.create(this.ws(user), user.id, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSavedFilterSchema)) body: UpdateSavedFilterBody,
  ) {
    return this.filters.update(this.ws(user), user.id, id, body);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.filters.softDelete(this.ws(user), user.id, id);
  }

  @Get(':id/run')
  async run(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.filters.run(this.ws(user), user.id, id, { cursor, limit: lim });
  }
}
