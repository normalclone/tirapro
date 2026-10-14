import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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

  // ----- Severities -----

  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get('severities')
  async listSeverities(@WorkspaceId() workspaceId: string) {
    return this.catalog.listSeverities(workspaceId);
  }

  @Post('severities')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createSeverity(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createSeveritySchema)) dto: CreateSeverityBody,
  ) {
    return this.catalog.createSeverity(workspaceId, dto);
  }

  @Patch('severities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updateSeverity(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSeveritySchema)) dto: UpdateSeverityBody,
  ) {
    return this.catalog.updateSeverity(workspaceId, id, dto);
  }

  @Delete('severities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removeSeverity(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.catalog.removeSeverity(workspaceId, id);
  }

  // ----- Priorities -----

  @Permissions(PERMISSIONS.WORKSPACE_VIEW)
  @Get('priorities')
  async listPriorities(@WorkspaceId() workspaceId: string) {
    return this.catalog.listPriorities(workspaceId);
  }

  @Post('priorities')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async createPriority(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createPrioritySchema)) dto: CreatePriorityBody,
  ) {
    return this.catalog.createPriority(workspaceId, dto);
  }

  @Patch('priorities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async updatePriority(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePrioritySchema)) dto: UpdatePriorityBody,
  ) {
    return this.catalog.updatePriority(workspaceId, id, dto);
  }

  @Delete('priorities/:id')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async removePriority(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.catalog.removePriority(workspaceId, id);
  }
}
