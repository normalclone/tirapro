import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  EXCEL_IMPORT_MAX_BYTES,
  excelImportBodySchema,
  jiraImportRunSchema,
  type ExcelImportBody,
  type JiraImportRunInput,
} from '@tirapro/shared';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceId } from '../../common/decorators/workspace-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { contentDispositionAttachment } from '../../common/filename';
import { ExcelImportService } from './excel/excel-import.service';
import { ImportService } from './import.service';
import { JIRA_MAX_UPLOAD_BYTES, JiraImportService } from './jira/jira-import.service';

/** Body cho import CSV (validate qua ZodValidationPipe). */
const importCsvSchema = z.object({
  projectId: z.string().min(1),
  csv: z.string().min(1),
});
export type ImportCsvBody = z.infer<typeof importCsvSchema>;

/**
 * Body cho import JSON: tiêu thụ bản export của Export module.
 * Schema permissive — chỉ ràng buộc `data` là object có mảng `issues`,
 * giữ nguyên các field khác để round-trip với mọi schemaVersion.
 */
const importJsonSchema = z.object({
  projectId: z.string().min(1),
  data: z.object({ issues: z.array(z.any()) }).passthrough(),
});
export type ImportJsonBody = z.infer<typeof importJsonSchema>;

@ApiTags('import')
@Controller('import')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly jira: JiraImportService,
    private readonly excel: ExcelImportService,
  ) {}

  /** Import issue từ CSV vào một project sẵn có. */
  @Post('csv')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async importCsv(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importCsvSchema)) body: ImportCsvBody,
  ) {
    return this.importService.importCsv(workspaceId, user.id, body);
  }

  /** Import từ bản export JSON (round-trip với Export module) vào một project sẵn có. */
  @Post('json')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async importJson(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importJsonSchema)) body: ImportJsonBody,
  ) {
    return this.importService.importJson(workspaceId, user.id, body);
  }

  /** Excel: tải biểu mẫu `.xlsx` của dự án (drop-list lấy từ cấu hình dự án). */
  @Get('excel/template')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async excelTemplate(
    @WorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(excelImportBodySchema)) query: ExcelImportBody,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.excel.template(workspaceId, query.projectId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', contentDispositionAttachment(filename));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /** Excel: xem trước lỗi từng dòng/cột — không ghi DB. */
  @Post('excel/preview')
  @HttpCode(200)
  @Permissions(PERMISSIONS.IMPORT_RUN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES } }))
  async excelPreview(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(excelImportBodySchema)) body: ExcelImportBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.excel.preview(workspaceId, body.projectId, file);
  }

  /** Excel: nhập các dòng hợp lệ (validate lại từ đầu), bỏ dòng lỗi. */
  @Post('excel')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES } }))
  async importExcel(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(excelImportBodySchema)) body: ExcelImportBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.excel.commit(workspaceId, user.id, body.projectId, file);
  }

  /** Lịch sử các lần import của workspace (mới nhất trước). */
  @Get('jobs')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async listJobs(
    @WorkspaceId() workspaceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listJobs(workspaceId, cursor, Number(limit) || 20);
  }

  /** Tiến độ / kết quả một lần import (web poll mỗi 2 giây). */
  @Get('jobs/:id')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async getJob(@WorkspaceId() workspaceId: string, @Param('id') id: string) {
    return this.importService.getJob(workspaceId, id);
  }

  /** Jira bước 1: tải CSV export (≤ 25MB), trả tóm tắt để dựng bảng mapping. */
  @Post('jira/analyze')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: JIRA_MAX_UPLOAD_BYTES } }))
  async jiraAnalyze(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.jira.analyze(workspaceId, user.id, file);
  }

  /** Jira bước 2: giá trị Tirapro (project, loại, ưu tiên, trạng thái, thành viên) để ghép. */
  @Get('jira/targets')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async jiraTargets(@WorkspaceId() workspaceId: string, @Query('projectId') projectId?: string) {
    return this.jira.targets(workspaceId, projectId || undefined);
  }

  /** Jira bước 3: kiểm tra mapping, chạy thử (dryRun) hoặc chạy nền và trả `{ jobId }`. */
  @Post('jira/run')
  @Permissions(PERMISSIONS.WORKSPACE_ADMIN)
  async jiraRun(
    @WorkspaceId() workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(jiraImportRunSchema)) body: JiraImportRunInput,
  ) {
    return this.jira.run(workspaceId, user.id, body);
  }
}
