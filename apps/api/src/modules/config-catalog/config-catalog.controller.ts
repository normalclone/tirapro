import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ConfigCatalogService } from './config-catalog.service';

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Màu phải là mã hex hợp lệ');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Tên không được để trống')
  .max(50, 'Tên tối đa 50 ký tự');

// ----- Severity schemas -----

const createSeveritySchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự').optional(),
  color: hexColor.optional(),
  rank: z.number().int('Rank phải là số nguyên').optional(),
});
type CreateSeverityBody = z.infer<typeof createSeveritySchema>;

const updateSeveritySchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự').optional(),
    color: hexColor.optional(),
    rank: z.number().int('Rank phải là số nguyên').optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateSeverityBody = z.infer<typeof updateSeveritySchema>;

// ----- Priority schemas -----

const createPrioritySchema = z.object({
  name: nameSchema,
  iconKey: z.string().trim().max(50, 'iconKey tối đa 50 ký tự').optional(),
  color: hexColor.optional(),
  rank: z.number().int('Rank phải là số nguyên').optional(),
});
type CreatePriorityBody = z.infer<typeof createPrioritySchema>;

const updatePrioritySchema = z
  .object({
    name: nameSchema.optional(),
    iconKey: z.string().trim().max(50, 'iconKey tối đa 50 ký tự').optional(),
    color: hexColor.optional(),
    rank: z.number().int('Rank phải là số nguyên').optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdatePriorityBody = z.infer<typeof updatePrioritySchema>;

@ApiTags('config')
@Controller()
export class ConfigCatalogController {
  constructor(private readonly catalog: ConfigCatalogService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ----- Severities -----

  @Get('severities')
  async listSeverities(@CurrentUser() user: AuthUser) {
    return this.catalog.listSeverities(this.ws(user));
  }

  @Post('severities')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createSeverity(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSeveritySchema)) dto: CreateSeverityBody,
  ) {
    return this.catalog.createSeverity(this.ws(user), dto);
  }

  @Patch('severities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updateSeverity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSeveritySchema)) dto: UpdateSeverityBody,
  ) {
    return this.catalog.updateSeverity(this.ws(user), id, dto);
  }

  @Delete('severities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removeSeverity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalog.removeSeverity(this.ws(user), id);
  }

  // ----- Priorities -----

  @Get('priorities')
  async listPriorities(@CurrentUser() user: AuthUser) {
    return this.catalog.listPriorities(this.ws(user));
  }

  @Post('priorities')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createPriority(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPrioritySchema)) dto: CreatePriorityBody,
  ) {
    return this.catalog.createPriority(this.ws(user), dto);
  }

  @Patch('priorities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updatePriority(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePrioritySchema)) dto: UpdatePriorityBody,
  ) {
    return this.catalog.updatePriority(this.ws(user), id, dto);
  }

  @Delete('priorities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removePriority(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalog.removePriority(this.ws(user), id);
  }
}
