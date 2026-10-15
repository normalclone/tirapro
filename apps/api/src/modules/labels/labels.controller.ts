import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LabelsService } from './labels.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '@tirapro/types';
import { IssueOwnershipService } from '../rbac/issue-ownership.service';
import { OwnOnly } from '../../common/decorators/own-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Màu phải là mã hex hợp lệ');

const createLabelSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tên nhãn không được để trống')
    .max(50, 'Tên nhãn tối đa 50 ký tự'),
  color: hexColor.optional(),
});
type CreateLabelDto = z.infer<typeof createLabelSchema>;

const updateLabelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Tên nhãn không được để trống')
      .max(50, 'Tên nhãn tối đa 50 ký tự')
      .optional(),
    color: hexColor.optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
type UpdateLabelDto = z.infer<typeof updateLabelSchema>;

const attachLabelSchema = z.object({
  labelId: z.string().min(1, 'Thiếu labelId'),
});
type AttachLabelDto = z.infer<typeof attachLabelSchema>;

@ApiTags('labels')
@Controller()
export class LabelsController {
  constructor(
    private readonly labels: LabelsService,
    private readonly ownership: IssueOwnershipService,
  ) {}

  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('param', 'projectId')
  @Get('projects/:projectId/labels')
  async list(@WorkspaceId() workspaceId: string, @Param('projectId') projectId: string) {
    return this.labels.list(workspaceId, projectId);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('param', 'projectId')
  @Post('projects/:projectId/labels')
  async create(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createLabelSchema)) dto: CreateLabelDto,
  ) {
    return this.labels.create(workspaceId, projectId, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('label', 'id')
  @Patch('labels/:id')
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLabelSchema)) dto: UpdateLabelDto,
  ) {
    return this.labels.update(workspaceId, id, dto);
  }

  @Permissions(PERMISSIONS.PROJECT_ADMIN)
  @ProjectRef('label', 'id')
  @Delete('labels/:id')
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.labels.remove(workspaceId, id);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Post('issues/:issueId/labels')
  async attach(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachLabelSchema)) dto: AttachLabelDto,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.labels.attach(workspaceId, issueId, dto.labelId);
  }

  @Permissions(PERMISSIONS.ISSUE_EDIT)
  @ProjectRef('issue', 'issueId')
  @Delete('issues/:issueId/labels/:labelId')
  async detach(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('labelId') labelId: string,
    @OwnOnly(PERMISSIONS.ISSUE_EDIT) ownOnly: boolean,
  ) {
    await this.ownership.assertOwnsIssue(ownOnly, workspaceId, user.id, issueId);
    return this.labels.detach(workspaceId, issueId, labelId);
  }
}
