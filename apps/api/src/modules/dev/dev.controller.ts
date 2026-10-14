import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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

  /** Kết nối repository code (GitHub/GitLab) với workspace. */
  @Post('dev/repositories')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createRepository(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createRepositorySchema)) body: CreateRepositoryBody,
  ) {
    return this.dev.createRepository(workspaceId, body);
  }

  /** Liệt kê repository của workspace (lọc theo project nếu truyền). */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('dev/repositories')
  async listRepositories(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.dev.listRepositories(workspaceId, projectId);
  }

  /** Gỡ kết nối một repository. */
  @ProjectRef('repository', 'id')
  @Delete('dev/repositories/:id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeRepository(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.dev.removeRepository(workspaceId, id);
  }

  /** Danh sách dev-link (commit/PR/branch) của một issue — dùng cho dev panel. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/dev-links')
  async listIssueDevLinks(@WorkspaceId() workspaceId: string, @Param('issueId') issueId: string) {
    return this.dev.listIssueDevLinks(workspaceId, issueId);
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
