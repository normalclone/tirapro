import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/request';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DevLinksService } from './dev-links.service';

/** Body kết nối repository code (GitHub/GitLab) với organization. */
const createRepositorySchema = z.object({
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
export class DevLinksController {
  constructor(private readonly devLinks: DevLinksService) {}

  /** Kết nối repository code (GitHub/GitLab) với organization. */
  @Post('dev/repositories')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async createRepository(
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(createRepositorySchema)) body: CreateRepositoryBody,
  ) {
    return this.devLinks.createRepository(organizationId, body);
  }

  /** Liệt kê repository của tổ chức (lọc theo project nếu truyền). */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  @Get('dev/repositories')
  async listRepositories(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.devLinks.listRepositories(organizationId, projectId, user.id);
  }

  /** Gỡ kết nối một repository. */
  @ProjectRef('repository', 'id')
  @Delete('dev/repositories/:id')
  @Permissions(PERMISSIONS.INTEGRATION_MANAGE)
  async removeRepository(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.devLinks.removeRepository(organizationId, id);
  }

  /** Danh sách dev-link (commit/PR/branch) của một issue — dùng cho dev panel. */
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('issue', 'issueId')
  @Get('issues/:issueId/dev-links')
  async listIssueDevLinks(
    @OrganizationId() organizationId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.devLinks.listIssueDevLinks(organizationId, issueId);
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
    return this.devLinks.handleWebhook(
      repositoryId,
      { githubSignature, gitlabToken, rawBody: req.rawBody },
      body ?? {},
    );
  }
}
