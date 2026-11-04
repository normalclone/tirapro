import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CustomFieldType } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomFieldsService } from './custom-fields.service';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

/** Body tạo custom field. SELECT/MULTI_SELECT có thể kèm options. */
const createCustomFieldSchema = z.object({
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
const updateCustomFieldSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    isRequired: z.boolean().optional(),
    order: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Không có thay đổi nào' });
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldSchema>;

/** Body đặt giá trị field cho issue. Kiểu của `value` tuỳ loại field (kiểm tra ở service). */
const setCustomFieldValueSchema = z.object({ value: z.unknown() });

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
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.customFields.listDefinitions(organizationId, projectId || undefined, user.id);
  }

  @Post('custom-fields')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async create(
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createCustomFieldSchema)) dto: CreateCustomFieldBody,
  ) {
    return this.customFields.createDefinition(organizationId, dto);
  }

  @ProjectRef('customField', 'id')
  @Patch('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) dto: UpdateCustomFieldBody,
  ) {
    return this.customFields.updateDefinition(organizationId, id, dto);
  }

  @ProjectRef('customField', 'id')
  @Delete('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.customFields.softDeleteDefinition(organizationId, id);
  }

  // ============================ VALUES (per issue) ============================

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/custom-fields')
  async listIssueValues(
    @OrganizationId() organizationId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.customFields.listIssueValues(organizationId, issueId);
  }

  @ProjectRef('issue', 'issueId')
  @Put('issues/:issueId/custom-fields/:fieldId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setIssueValue(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(setCustomFieldValueSchema)) body: { value: unknown },
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, organizationId, user.id, issueId);
    return this.customFields.setIssueValue(organizationId, issueId, fieldId, body.value);
  }
}
