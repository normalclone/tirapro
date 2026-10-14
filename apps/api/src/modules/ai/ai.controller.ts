import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { generateIssuesSchema, type GenerateIssuesInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { AiService } from './ai.service';
import { AuthOnly } from '../../common/decorators/auth-only.decorator';

@ApiTags('ai')
@Controller('ai')
// Mỗi lời gọi AI tốn tiền → giới hạn chặt hơn mặc định toàn cục: 20 lần/phút.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Trạng thái khả dụng của AI (không cần quyền — chỉ báo bật/tắt). */
  // Chỉ báo AI bật/tắt cho mọi người dùng đã đăng nhập, không lộ dữ liệu workspace.
  @AuthOnly()
  @Get('capabilities')
  capabilities() {
    return this.ai.capabilities();
  }

  @Post('generate-issues')
  @Permissions(PERMISSIONS.AI_USE)
  async generateIssues(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateIssuesSchema)) dto: GenerateIssuesInput,
  ) {
    return this.ai.generateIssues(workspaceId, user.id, dto);
  }

  @ProjectRef('issue', 'id')
  @Post('issues/:id/summary')
  @Permissions(PERMISSIONS.AI_USE)
  async summarize(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.ai.summarizeIssue(workspaceId, user.id, id);
  }

  @ProjectRef('issue', 'id')
  @Post('issues/:id/suggest')
  @Permissions(PERMISSIONS.AI_USE)
  async suggest(@CurrentUser() user: AuthUser, @WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.ai.suggest(workspaceId, user.id, id);
  }
}
