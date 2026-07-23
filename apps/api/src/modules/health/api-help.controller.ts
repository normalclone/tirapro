import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

/** Bản đồ nhanh của API cho tích hợp/AI khám phá ngữ cảnh (public, không cần auth). */
@ApiTags('help')
@Controller()
export class ApiHelpController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('help')
  @ApiOperation({ summary: 'Tổng quan API + MCP để tích hợp/AI khám phá ngữ cảnh' })
  help() {
    const prefix = this.config.get<string>('api.globalPrefix') ?? 'api';
    const version = this.config.get<string>('api.version') ?? 'v1';
    const base = `/${prefix}/${version}`;
    const mcpUrl = process.env.MCP_PUBLIC_URL ?? 'http://localhost:4100/mcp';

    return {
      name: 'Tirapro API',
      version,
      baseUrl: base,
      docs: { swaggerUi: `/${prefix}/docs`, openapi: `/${prefix}/docs-json` },
      auth: {
        header: 'Authorization: Bearer <token>',
        alt: 'X-API-Key: tira_…',
        note: 'token = JWT (đăng nhập web) hoặc API key tira_ (Cài đặt → API & MCP). Quyền theo RBAC của chủ khoá; khoá read-only chỉ gọi được GET.',
      },
      concepts: {
        workspace: 'Mọi dữ liệu thuộc 1 workspace (tenant); API key gắn cứng 1 workspace.',
        issueKey: 'Định dạng {DỰ_ÁN}-{LOẠI}-{số}, vd DEMO-BUG-1. GET theo key; PATCH/transition theo id.',
        occ: 'Cập nhật issue cần gửi "version" hiện tại (optimistic concurrency).',
      },
      rest: [
        { group: 'Projects', endpoints: ['GET /projects', 'GET /projects/:key/meta (loại issue, độ ưu tiên…)'] },
        { group: 'Issues', endpoints: ['GET /issues?projectId&statusId&assigneeId&typeId&sprintId&search&cursor&limit', 'GET /issues/:key', 'POST /issues', 'PATCH /issues/:id', 'POST /issues/:id/transition', 'POST /issues/:id/move'] },
        { group: 'Comments', endpoints: ['GET /issues/:issueId/comments', 'POST /issues/:issueId/comments'] },
        { group: 'Sprints', endpoints: ['GET /sprints?projectId'] },
        { group: 'Users', endpoints: ['GET /users'] },
      ],
      mcp: {
        url: mcpUrl,
        transport: 'streamable-http',
        auth: 'Authorization: Bearer tira_…',
        tools: [
          'help', 'get_context',
          'list_projects', 'list_issues', 'get_issue', 'list_sprints', 'list_members',
          'create_issue', 'update_issue', 'add_comment',
        ],
      },
    };
  }
}
