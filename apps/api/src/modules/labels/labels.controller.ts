import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { LabelsService } from './labels.service';

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Màu phải là mã hex hợp lệ');

const createLabelSchema = z.object({
  name: z.string().trim().min(1, 'Tên nhãn không được để trống').max(50, 'Tên nhãn tối đa 50 ký tự'),
  color: hexColor.optional(),
});
type CreateLabelDto = z.infer<typeof createLabelSchema>;

const updateLabelSchema = z
  .object({
    name: z.string().trim().min(1, 'Tên nhãn không được để trống').max(50, 'Tên nhãn tối đa 50 ký tự').optional(),
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
  constructor(private readonly labels: LabelsService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  @Get('projects/:projectId/labels')
  async list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.labels.list(this.ws(user), projectId);
  }

  @Post('projects/:projectId/labels')
  async create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createLabelSchema)) dto: CreateLabelDto,
  ) {
    return this.labels.create(this.ws(user), projectId, dto);
  }

  @Patch('labels/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLabelSchema)) dto: UpdateLabelDto,
  ) {
    return this.labels.update(this.ws(user), id, dto);
  }

  @Delete('labels/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.labels.remove(this.ws(user), id);
  }

  @Post('issues/:issueId/labels')
  async attach(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body(new ZodValidationPipe(attachLabelSchema)) dto: AttachLabelDto,
  ) {
    return this.labels.attach(this.ws(user), issueId, dto.labelId);
  }

  @Delete('issues/:issueId/labels/:labelId')
  async detach(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('labelId') labelId: string,
  ) {
    return this.labels.detach(this.ws(user), issueId, labelId);
  }
}
