import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FixVersionType, VersionStatus } from '@tirapro/types';
import { z } from 'zod';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
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
  async listComponents(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.components.listComponents(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/components')
  async createComponent(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createComponentSchema)) dto: CreateComponentDto,
  ) {
    return this.components.createComponent(workspaceId, projectId, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('component', 'id')
  @Patch('components/:id')
  async updateComponent(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateComponentSchema)) dto: UpdateComponentDto,
  ) {
    return this.components.updateComponent(workspaceId, id, {
      name: dto.name,
      description: dto.description,
      leadId: dto.leadId ?? undefined,
    });
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('component', 'id')
  @Delete('components/:id')
  async removeComponent(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.components.removeComponent(workspaceId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/components')
  async attachComponent(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachComponentSchema)) dto: AttachComponentDto,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.components.attachComponent(workspaceId, user.id, issueId, dto.componentId);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/components/:componentId')
  async detachComponent(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('componentId') componentId: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.components.detachComponent(workspaceId, user.id, issueId, componentId);
  }

  // ============================ VERSIONS ====================================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/versions')
  async listVersions(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.components.listVersions(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/versions')
  async createVersion(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createVersionSchema)) dto: CreateVersionDto,
  ) {
    return this.components.createVersion(workspaceId, projectId, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('version', 'id')
  @Patch('versions/:id')
  async updateVersion(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVersionSchema)) dto: UpdateVersionDto,
  ) {
    return this.components.updateVersion(workspaceId, id, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('version', 'id')
  @Delete('versions/:id')
  async removeVersion(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.components.removeVersion(workspaceId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/versions')
  async attachVersion(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachVersionSchema)) dto: AttachVersionDto,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.components.attachVersion(workspaceId, user.id, issueId, dto.versionId, dto.type);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/versions/:versionId/:type')
  async detachVersion(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('versionId') versionId: string,
    @Param('type', new ZodValidationPipe(fixVersionTypeSchema)) type: FixVersionType,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.components.detachVersion(workspaceId, user.id, issueId, versionId, type);
  }
}
