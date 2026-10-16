import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import {
  createRuleSchema,
  listRulesQuerySchema,
  testRuleSchema,
  updateRuleSchema,
  type CreateRuleInput,
  type TestRuleInput,
  type UpdateRuleInput,
} from '@tirapro/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { RuleEngineService } from './rule-engine.service';
import { RulesService } from './rules.service';

/**
 * Quy tắc tự động hoá (khi… nếu… thì…). Quy tắc của dự án cần `automation:manage` ở dự án đó;
 * quy tắc cả workspace (không có projectId) cần quyền ở cấp workspace (quản trị workspace).
 */
@ApiTags('automation-rules')
@Controller('automation/rules')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly engine: RuleEngineService,
  ) {}

  @ProjectRef('query', 'projectId')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get()
  async list(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listRulesQuerySchema)) query: { projectId?: string },
  ) {
    return this.rules.list(workspaceId, query.projectId);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get(':id')
  async get(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.rules.get(workspaceId, id);
  }

  @ProjectRef('body', 'projectId')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Post()
  async create(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRuleSchema)) dto: CreateRuleInput,
  ) {
    return this.rules.create(workspaceId, user.id, dto);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Patch(':id')
  async update(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRuleSchema)) dto: UpdateRuleInput,
  ) {
    return this.rules.update(workspaceId, id, dto);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Delete(':id')
  async remove(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.rules.remove(workspaceId, id);
  }

  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Get(':id/runs')
  async runs(
    @WorkspaceId() workspaceId: string,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.rules.runs(workspaceId, id, cursor);
  }

  /** Chạy thử trên một issue: trả log, không áp dụng thay đổi nào. */
  @ProjectRef('automationRule', 'id')
  @Permissions(PERMISSIONS.AUTOMATION_MANAGE)
  @Post(':id/test')
  async test(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testRuleSchema)) dto: TestRuleInput,
  ) {
    const rule = await this.rules.require(workspaceId, id);
    return this.engine.dryRun(
      workspaceId,
      { ...rule, lastRunAt: rule.lastRunAt?.toISOString() ?? null },
      dto.issueKey,
      user.id,
    );
  }
}
