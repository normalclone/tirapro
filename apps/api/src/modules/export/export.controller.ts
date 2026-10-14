import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import type { Response } from 'express';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ExportService, type ProjectExport } from './export.service';

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
}
