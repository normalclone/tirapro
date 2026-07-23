import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@tirapro/types';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ExportService, type ProjectExport } from './export.service';

@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(private readonly export_: ExportService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Xuất toàn bộ một project ra file JSON tự chứa (data portability). */
  @Get('project/:projectId')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async exportProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectExport> {
    const data = await this.export_.exportProject(this.ws(user), projectId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tirapro-export-${data.project.key}.json"`,
    );
    return data;
  }
}
