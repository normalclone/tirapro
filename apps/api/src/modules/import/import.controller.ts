import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@tirapro/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/types/request';
import { ImportService } from './import.service';

/** Body cho import CSV (validate qua ZodValidationPipe). */
export const importCsvSchema = z.object({
  projectId: z.string().min(1),
  csv: z.string().min(1),
});
export type ImportCsvBody = z.infer<typeof importCsvSchema>;

/**
 * Body cho import JSON: tiêu thụ bản export của Export module.
 * Schema permissive — chỉ ràng buộc `data` là object có mảng `issues`,
 * giữ nguyên các field khác để round-trip với mọi schemaVersion.
 */
export const importJsonSchema = z.object({
  projectId: z.string().min(1),
  data: z
    .object({ issues: z.array(z.any()) })
    .passthrough(),
});
export type ImportJsonBody = z.infer<typeof importJsonSchema>;

@ApiTags('import')
@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Import issue từ CSV vào một project sẵn có. */
  @Post('csv')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async importCsv(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importCsvSchema)) body: ImportCsvBody,
  ) {
    return this.importService.importCsv(this.ws(user), user.id, body);
  }

  /** Import từ bản export JSON (round-trip với Export module) vào một project sẵn có. */
  @Post('json')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async importJson(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importJsonSchema)) body: ImportJsonBody,
  ) {
    return this.importService.importJson(this.ws(user), user.id, body);
  }

  /** Lịch sử các lần import của workspace (mới nhất trước). */
  @Get('jobs')
  @Permissions(PERMISSIONS.IMPORT_RUN)
  async listJobs(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importService.listJobs(this.ws(user), cursor, Number(limit) || 20);
  }
}
