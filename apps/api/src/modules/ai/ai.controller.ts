import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { generateIssuesSchema, type GenerateIssuesInput } from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Trạng thái khả dụng của AI (không cần quyền — chỉ báo bật/tắt). */
  @Get('capabilities')
  capabilities() {
    return this.ai.capabilities();
  }

  @Post('generate-issues')
  @Permissions(PERMISSIONS.AI_USE)
  async generateIssues(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateIssuesSchema)) dto: GenerateIssuesInput,
  ) {
    return this.ai.generateIssues(this.ws(user), dto);
  }

  @Post('issues/:id/summary')
  @Permissions(PERMISSIONS.AI_USE)
  async summarize(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.summarizeIssue(this.ws(user), id);
  }

  @Post('issues/:id/suggest')
  @Permissions(PERMISSIONS.AI_USE)
  async suggest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.suggest(this.ws(user), id);
  }
}
