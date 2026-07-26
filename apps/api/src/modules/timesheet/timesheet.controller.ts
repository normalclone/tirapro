import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbiddenAppException } from '../../common/exceptions/app.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/types/request';
import { TimesheetService } from './timesheet.service';
import {
  issueSearchQuerySchema, logTimeSchema, setCellSchema, timesheetQuerySchema,
  type IssueSearchQuery, type LogTimeInput, type SetCellInput, type TimesheetQuery,
} from './timesheet.schemas';

/**
 * Chấm công — không có bước duyệt.
 * Không gắn `@Permissions`: mọi người đã đăng nhập đều chấm công CỦA MÌNH; thao tác
 * trên người khác được service kiểm tra `resource:manage` qua RbacService.
 */
@ApiTags('timesheet')
@Controller('timesheet')
export class TimesheetController {
  constructor(private readonly timesheet: TimesheetService) {}

  private ws(user: AuthUser): string {
    if (!user.workspaceId) throw new ForbiddenAppException('Chưa chọn workspace');
    return user.workspaceId;
  }

  /** Lưới ISSUE × NGÀY trong khoảng [from, to] (mặc định tuần hiện tại). */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(timesheetQuerySchema)) q: TimesheetQuery,
  ) {
    return this.timesheet.getTimesheet(this.ws(user), user, q);
  }

  /** Tìm công việc để thêm dòng vào lưới. */
  @Get('issues')
  async issues(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(issueSearchQuerySchema)) q: IssueSearchQuery,
  ) {
    return this.timesheet.searchIssues(this.ws(user), q);
  }

  /** Ghi nhanh một bản ghi công (cộng dồn). */
  @Post('log')
  async log(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(logTimeSchema)) dto: LogTimeInput,
  ) {
    return this.timesheet.logTime(this.ws(user), user, dto);
  }

  /** Đặt tổng giờ của một ô (issue × ngày) — dùng khi nhập trực tiếp trên lưới. */
  @Put('cell')
  async setCell(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setCellSchema)) dto: SetCellInput,
  ) {
    return this.timesheet.setCell(this.ws(user), user, dto);
  }

  @Delete('log/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.timesheet.deleteLog(this.ws(user), user, id);
  }
}
