import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@tirapro/types';
import {
  createRuleSchema,
  listRulesQuerySchema,
  previewMatchSchema,
  testRuleSchema,
  updateRuleSchema,
  type CreateRuleInput,
  type PreviewMatchInput,
  type TestRuleInput,
  type UpdateRuleInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RuleEngineService } from './rule-engine.service';
import { RulePreviewService } from './rule-preview.service';
import { RulesService } from './rules.service';

/**
 * Quy tắc tự động hoá (khi… nếu… thì…). Quy tắc của dự án cần `automation:manage` ở dự án đó;
 * quy tắc cả tổ chức (không có projectId) cần quyền ở cấp tổ chức (quản trị tổ chức).
 */
@ApiTags('automation-rules')
@Controller('automation/rules')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly engine: RuleEngineService,
    private readonly preview: RulePreviewService,
  ) {}

  @ProjectRef('query', 'projectId')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get()
  async list(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listRulesQuerySchema)) query: { projectId?: string },
  ) {
    return this.rules.list(organizationId, query.projectId, user.id);
  }

  /**
   * "Khớp N việc hiện có" cho điều kiện đang soạn (chưa lưu). Chỉ đếm trong phạm vi NGƯỜI SOẠN xem được. Mỗi lần gọi là
   * MỘT truy vấn đếm qua semaphore chung (xem `common/bounded-count`); throttle 30/phút theo IP (tracker mặc định —
   * `ThrottlerGuard` chạy trước `JwtAuthGuard` nên chưa có người dùng), trần kết nối thật nằm ở service.
   */
  @ProjectRef('body', 'projectId')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('preview-match')
  async previewMatch(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(previewMatchSchema)) dto: PreviewMatchInput,
  ) {
    return this.preview.previewMatch(organizationId, user.id, dto);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get(':id')
  async get(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.rules.get(organizationId, id);
  }

  @ProjectRef('body', 'projectId')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Post()
  async create(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRuleSchema)) dto: CreateRuleInput,
  ) {
    return this.rules.create(organizationId, user.id, dto);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Patch(':id')
  async update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRuleSchema)) dto: UpdateRuleInput,
  ) {
    return this.rules.update(organizationId, id, dto);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Delete(':id')
  async remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.rules.remove(organizationId, id);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get(':id/runs')
  async runs(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.rules.runs(organizationId, id, cursor);
  }

  /** Chạy thử trên một issue: trả log, không áp dụng thay đổi nào. */
  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Post(':id/test')
  async test(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testRuleSchema)) dto: TestRuleInput,
  ) {
    const rule = await this.rules.require(organizationId, id);
    return this.engine.dryRun(
      organizationId,
      { ...rule, lastRunAt: rule.lastRunAt?.toISOString() ?? null },
      dto.issueKey,
      user.id,
    );
  }
}
