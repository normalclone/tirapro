import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

/**
 * Module Automation — mẫu issue + việc lặp lại (cron sinh issue định kỳ).
 * Cron @nestjs/schedule cần ScheduleModule.forRoot() đăng ký toàn cục (app.module lo).
 * Import IssuesModule để tạo issue qua IssuesService (đi đúng luồng workflow/rank/sự kiện).
 */
@Module({
  imports: [IssuesModule],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
