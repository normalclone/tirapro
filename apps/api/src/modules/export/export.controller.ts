import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import type { Response } from 'express';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ProjectRef } from '../../common/decorators/project-ref.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { ExportService, type ProjectExport } from './export.service';
import { issuesCsvQuerySchema, type IssuesCsvQuery } from './issues-csv';

@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(private readonly export_: ExportService) {}

  /** Xuất toàn bộ một project ra file JSON tự chứa (data portability). */
  @Get('project/:projectId')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async exportProject(
    @WorkspaceId() workspaceId: string,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectExport> {
    const data = await this.export_.exportProject(workspaceId, projectId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tirapro-export-${data.project.key}.json"`,
    );
    return data;
  }

  /**
   * CSV công việc (JQL/bộ lọc, Việc chờ, bug, sprint). Cùng luật quyền với `GET /search`: người xem được dự án
   * (reporter trở lên) xuất được — KHÔNG đòi `import:run`. Chạm trần 5.000 dòng → header `X-Export-Truncated: true`.
   */
  @Get('issues.csv')
  @Permissions(PERMISSIONS.PROJECT_VIEW)
  @ProjectRef('query', 'projectId')
  async exportIssuesCsv(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(issuesCsvQuerySchema)) query: IssuesCsvQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { csv, truncated, filename, rows } = await this.export_.exportIssuesCsv(
      workspaceId,
      user.id,
      query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('X-Export-Rows', String(rows));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    return csv;
  }
}
