import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { DevService } from './dev.service';

/** Body kết nối repository code (GitHub/GitLab) với workspace. */
export const createRepositorySchema = z.object({
  integrationId: z.string().min(1, 'Thiếu integrationId'),
  provider: z.enum(['GITHUB', 'GITLAB']),
  externalId: z.string().min(1, 'Thiếu externalId'),
  name: z.string().min(1, 'Thiếu tên repository'),
  url: z.string().url('URL không hợp lệ'),
  defaultBranch: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
});
export type CreateRepositoryBody = z.infer<typeof createRepositorySchema>;

@ApiTags('dev')
@Controller()
export class DevController {
  constructor(private readonly dev: DevService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Bạn chưa chọn không gian làm việc — hãy chọn một không gian rồi thử lại');
    return user.workspaceId;
  }

  /** Kết nối repository code (GitHub/GitLab) với workspace. */
  @Post('dev/repositories')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createRepository(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRepositorySchema)) body: CreateRepositoryBody,
  ) {
    return this.dev.createRepository(this.ws(user), body);
  }

  /** Liệt kê repository của workspace (lọc theo project nếu truyền). */
  @Get('dev/repositories')
  async listRepositories(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.dev.listRepositories(this.ws(user), projectId);
  }

  /** Gỡ kết nối một repository. */
  @ProjectRef('repository', 'id')
  @Delete('dev/repositories/:id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeRepository(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dev.removeRepository(this.ws(user), id);
  }

  /** Danh sách dev-link (commit/PR/branch) của một issue — dùng cho dev panel. */
  @Get('issues/:issueId/dev-links')
  async listIssueDevLinks(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.dev.listIssueDevLinks(this.ws(user), issueId);
  }

  /**
   * Webhook provider (GitHub/GitLab) — PUBLIC, không qua JWT.
   * GitHub: ký HMAC-SHA256 trên body gốc (`X-Hub-Signature-256`). GitLab: so `X-Gitlab-Token`.
   */
  @Public()
  @Post('dev/webhook/:repositoryId')
  async webhook(
    @Param('repositoryId') repositoryId: string,
    @Headers('x-hub-signature-256') githubSignature: string | undefined,
    @Headers('x-gitlab-token') gitlabToken: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    return this.dev.handleWebhook(
      repositoryId,
      { githubSignature, gitlabToken, rawBody: req.rawBody },
      body ?? {},
    );
  }
}
