import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FixVersionType, VersionStatus } from '@tirapro/types';
import { z } from 'zod';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ComponentsService } from './components.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

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
  constructor(
    private readonly components: ComponentsService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  // ============================ COMPONENTS ==================================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/components')
  async listComponents(
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.components.listComponents(organizationId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/components')
  async createComponent(
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createComponentSchema)) dto: CreateComponentDto,
  ) {
    return this.components.createComponent(organizationId, projectId, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('component', 'id')
  @Patch('components/:id')
  async updateComponent(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateComponentSchema)) dto: UpdateComponentDto,
  ) {
    return this.components.updateComponent(organizationId, id, {
      name: dto.name,
      description: dto.description,
      leadId: dto.leadId ?? undefined,
    });
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('component', 'id')
  @Delete('components/:id')
  async removeComponent(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.components.removeComponent(organizationId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/components')
  async attachComponent(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachComponentSchema)) dto: AttachComponentDto,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.components.attachComponent(organizationId, user.id, issueId, dto.componentId);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/components/:componentId')
  async detachComponent(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('componentId') componentId: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.components.detachComponent(organizationId, user.id, issueId, componentId);
  }

  // ============================ VERSIONS ====================================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/versions')
  async listVersions(
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.components.listVersions(organizationId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/versions')
  async createVersion(
    @OrganizationId() organizationId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createVersionSchema)) dto: CreateVersionDto,
  ) {
    return this.components.createVersion(organizationId, projectId, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('version', 'id')
  @Patch('versions/:id')
  async updateVersion(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVersionSchema)) dto: UpdateVersionDto,
  ) {
    return this.components.updateVersion(organizationId, id, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('version', 'id')
  @Delete('versions/:id')
  async removeVersion(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.components.removeVersion(organizationId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/versions')
  async attachVersion(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachVersionSchema)) dto: AttachVersionDto,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.components.attachVersion(organizationId, user.id, issueId, dto.versionId, dto.type);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/versions/:versionId/:type')
  async detachVersion(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('versionId') versionId: string,
    @Param('type', new ZodValidationPipe(fixVersionTypeSchema)) type: FixVersionType,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.components.detachVersion(organizationId, user.id, issueId, versionId, type);
  }
}
