import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CustomFieldType } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomFieldsService } from './custom-fields.service';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

/** Body tạo custom field. SELECT/MULTI_SELECT có thể kèm options. */
export const createCustomFieldSchema = z.object({
  name: z.string().min(1, 'Tên field không được để trống').max(120),
  type: z.nativeEnum(CustomFieldType),
  projectId: z.string().min(1).optional(),
  isRequired: z.boolean().optional(),
  order: z.number().int().optional(),
  options: z
    .array(z.object({ value: z.string().min(1, 'Lựa chọn không được để trống') }))
    .optional(),
});
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldSchema>;

/** Body cập nhật field (không cho đổi `type`). */
export const updateCustomFieldSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    isRequired: z.boolean().optional(),
    order: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có thay đổi nào' });
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldSchema>;

/** Body đặt giá trị field cho issue. Kiểu của `value` tuỳ loại field (kiểm tra ở service). */
export const setCustomFieldValueSchema = z.object({ value: z.unknown() });

@ApiTags('custom-fields')
@Controller()
export class CustomFieldsController {
  constructor(
    private readonly customFields: CustomFieldsService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  // ============================ DEFINITIONS ============================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('custom-fields')
  async list(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.customFields.listDefinitions(workspaceId, projectId || undefined);
  }

  @Post('custom-fields')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async create(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createCustomFieldSchema)) dto: CreateCustomFieldBody,
  ) {
    return this.customFields.createDefinition(workspaceId, dto);
  }

  @ProjectRef('customField', 'id')
  @Patch('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) dto: UpdateCustomFieldBody,
  ) {
    return this.customFields.updateDefinition(workspaceId, id, dto);
  }

  @ProjectRef('customField', 'id')
  @Delete('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.customFields.softDeleteDefinition(workspaceId, id);
  }

  // ============================ VALUES (per issue) ============================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/custom-fields')
  async listIssueValues(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.customFields.listIssueValues(workspaceId, issueId);
  }

  @ProjectRef('issue', 'issueId')
  @Put('issues/:issueId/custom-fields/:fieldId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setIssueValue(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(setCustomFieldValueSchema)) body: { value: unknown },
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.customFields.setIssueValue(workspaceId, issueId, fieldId, body.value);
  }
}
