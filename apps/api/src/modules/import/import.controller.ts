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
import { Throttle } from '@nestjs/throttler';
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
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
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

/** Mỗi lần xem trước/nhập là tác vụ nặng CPU/RAM (giải nén + duyệt cả bảng): 10 lần/phút/IP. */
const EXCEL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

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
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importCsvSchema)) body: ImportCsvBody,
  ) {
    return this.importService.importCsv(organizationId, user.id, body);
  }

  /** Import từ bản export JSON (round-trip với Export module) vào một project sẵn có. */
  @Post('json')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async importJson(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importJsonSchema)) body: ImportJsonBody,
  ) {
    return this.importService.importJson(organizationId, user.id, body);
  }

  /** Excel: tải biểu mẫu `.xlsx` của dự án (drop-list lấy từ cấu hình dự án). */
  @Get('excel/template')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async excelTemplate(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(excelImportBodySchema)) query: ExcelImportBody,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.excel.template(organizationId, query.projectId);
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
  @Throttle(EXCEL_THROTTLE)
  @HttpCode(200)
  @Permissions(PERMISSIONS.IMPORT_RUN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES } }))
  async excelPreview(
    @OrganizationId() organizationId: string,
    @Body(new ZodValidationPipe(excelImportBodySchema)) body: ExcelImportBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.excel.preview(organizationId, body.projectId, file);
  }

  /** Excel: nhập các dòng hợp lệ (validate lại từ đầu), bỏ dòng lỗi. */
  @Post('excel')
  @Throttle(EXCEL_THROTTLE)
  @Permissions(PERMISSIONS.IMPORT_RUN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES } }))
  async importExcel(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(excelImportBodySchema)) body: ExcelImportBody,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.excel.commit(organizationId, user.id, body.projectId, file);
  }

  /** Lịch sử các lần import của tổ chức (mới nhất trước). */
  @Get('jobs')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async listJobs(
    @OrganizationId() organizationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listJobs(organizationId, cursor, Number(limit) || 20);
  }

  /** Tiến độ / kết quả một lần import (web poll mỗi 2 giây). */
  @Get('jobs/:id')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async getJob(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.importService.getJob(organizationId, id);
  }

  /** Jira bước 1: tải CSV export (≤ 25MB), trả tóm tắt để dựng bảng mapping. */
  @Post('jira/analyze')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: JIRA_MAX_UPLOAD_BYTES } }))
  async jiraAnalyze(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.jira.analyze(organizationId, user.id, file);
  }

  /** Jira bước 2: giá trị Tirapro (project, loại, ưu tiên, trạng thái, thành viên) để ghép. */
  @Get('jira/targets')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async jiraTargets(
    @OrganizationId() organizationId: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.jira.targets(organizationId, projectId || undefined);
  }

  /** Jira bước 3: kiểm tra mapping, chạy thử (dryRun) hoặc chạy nền và trả `{ jobId }`. */
  @Post('jira/run')
  @Permissions(PERMISSIONS.ORGANIZATION_ADMIN)
  async jiraRun(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(jiraImportRunSchema)) body: JiraImportRunInput,
  ) {
    return this.jira.run(organizationId, user.id, body);
  }
}
