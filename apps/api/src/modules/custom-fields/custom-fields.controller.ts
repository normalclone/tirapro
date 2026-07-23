import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CustomFieldType } from '@prisma/client';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import {
  CustomFieldsService,
  type CreateCustomFieldInput,
  type UpdateCustomFieldInput,
} from './custom-fields.service';

/** Body tạo custom field. SELECT/MULTI_SELECT có thể kèm options. */
export const createCustomFieldSchema = z.object({
  name: z.string().min(1, 'Tên field không được để trống').max(120),
  type: z.nativeEnum(CustomFieldType),
  projectId: z.string().min(1).optional(),
  isRequired: z.boolean().optional(),
  order: z.number().int().optional(),
  options: z.array(z.object({ value: z.string().min(1, 'Lựa chọn không được để trống') })).optional(),
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
  constructor(private readonly customFields: CustomFieldsService) {}

  /** Workspace hiện tại của user (bắt buộc đã chọn). */
  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  // ============================ DEFINITIONS ============================

  @Get('custom-fields')
  async list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.customFields.listDefinitions(this.ws(user), projectId || undefined);
  }

  @Post('custom-fields')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCustomFieldSchema)) dto: CreateCustomFieldBody,
  ) {
    return this.customFields.createDefinition(this.ws(user), dto as CreateCustomFieldInput);
  }

  @Patch('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) dto: UpdateCustomFieldBody,
  ) {
    return this.customFields.updateDefinition(this.ws(user), id, dto as UpdateCustomFieldInput);
  }

  @Delete('custom-fields/:id')
  @Permissions(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customFields.softDeleteDefinition(this.ws(user), id);
  }

  // ============================ VALUES (per issue) ============================

  @Get('issues/:issueId/custom-fields')
  async listIssueValues(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.customFields.listIssueValues(this.ws(user), issueId);
  }

  @Put('issues/:issueId/custom-fields/:fieldId')
  @Permissions(PERMISSIONS.ISSUE_EDIT)
  async setIssueValue(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('fieldId') fieldId: string,
    @Body(new ZodValidationPipe(setCustomFieldValueSchema)) body: { value: unknown },
  ) {
    return this.customFields.setIssueValue(this.ws(user), issueId, fieldId, body.value);
  }
}
