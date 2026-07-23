import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FixVersionType, VersionStatus } from '@tirapro/types';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ComponentsService } from './components.service';

// ============================ SCHEMAS — COMPONENTS ==========================
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Tên không được để trống')
  .max(80, 'Tên tối đa 80 ký tự');
const descriptionSchema = z.string().trim().max(500, 'Mô tả tối đa 500 ký tự');
const isoDate = z.string().datetime({ offset: true, message: 'Ngày phải đúng định dạng ISO-8601' });

const createComponentSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  leadId: z.string().min(1, 'leadId không hợp lệ').optional(),
});
type CreateComponentDto = z.infer<typeof createComponentSchema>;

const updateComponentSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    leadId: z.string().min(1, 'leadId không hợp lệ').nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateComponentDto = z.infer<typeof updateComponentSchema>;

const attachComponentSchema = z.object({
  componentId: z.string().min(1, 'Thiếu componentId'),
});
type AttachComponentDto = z.infer<typeof attachComponentSchema>;

// ============================ SCHEMAS — VERSIONS ============================
const versionStatusSchema = z.nativeEnum(VersionStatus);
const fixVersionTypeSchema = z.nativeEnum(FixVersionType);

const createVersionSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  status: versionStatusSchema.optional(),
  startDate: isoDate.optional(),
  releaseDate: isoDate.optional(),
});
type CreateVersionDto = z.infer<typeof createVersionSchema>;

const updateVersionSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    status: versionStatusSchema.optional(),
    startDate: isoDate.optional(),
    releaseDate: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateVersionDto = z.infer<typeof updateVersionSchema>;

const attachVersionSchema = z.object({
  versionId: z.string().min(1, 'Thiếu versionId'),
  type: fixVersionTypeSchema.default(FixVersionType.FIX),
});
type AttachVersionDto = z.infer<typeof attachVersionSchema>;

@ApiTags('components')
@Controller()
export class ComponentsController {
  constructor(private readonly components: ComponentsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ============================ COMPONENTS ==================================

  @Get('projects/:projectId/components')
  async listComponents(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.components.listComponents(this.ws(user), projectId);
  }

  @Post('projects/:projectId/components')
  async createComponent(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createComponentSchema)) dto: CreateComponentDto,
  ) {
    return this.components.createComponent(this.ws(user), projectId, dto);
  }

  @Patch('components/:id')
  async updateComponent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateComponentSchema)) dto: UpdateComponentDto,
  ) {
    return this.components.updateComponent(this.ws(user), id, {
      name: dto.name,
      description: dto.description,
      leadId: dto.leadId ?? undefined,
    });
  }

  @Delete('components/:id')
  async removeComponent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.components.removeComponent(this.ws(user), id);
  }

  @Post('issues/:issueId/components')
  async attachComponent(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachComponentSchema)) dto: AttachComponentDto,
  ) {
    return this.components.attachComponent(this.ws(user), issueId, dto.componentId);
  }

  @Delete('issues/:issueId/components/:componentId')
  async detachComponent(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('componentId') componentId: string,
  ) {
    return this.components.detachComponent(this.ws(user), issueId, componentId);
  }

  // ============================ VERSIONS ====================================

  @Get('projects/:projectId/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.components.listVersions(this.ws(user), projectId);
  }

  @Post('projects/:projectId/versions')
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createVersionSchema)) dto: CreateVersionDto,
  ) {
    return this.components.createVersion(this.ws(user), projectId, dto);
  }

  @Patch('versions/:id')
  async updateVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVersionSchema)) dto: UpdateVersionDto,
  ) {
    return this.components.updateVersion(this.ws(user), id, dto);
  }

  @Delete('versions/:id')
  async removeVersion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.components.removeVersion(this.ws(user), id);
  }

  @Post('issues/:issueId/versions')
  async attachVersion(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachVersionSchema)) dto: AttachVersionDto,
  ) {
    return this.components.attachVersion(this.ws(user), issueId, dto.versionId, dto.type);
  }

  @Delete('issues/:issueId/versions/:versionId/:type')
  async detachVersion(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('versionId') versionId: string,
    @Param('type', new ZodValidationPipe(fixVersionTypeSchema)) type: FixVersionType,
  ) {
    return this.components.detachVersion(this.ws(user), issueId, versionId, type);
  }
}
