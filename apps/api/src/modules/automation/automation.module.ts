import { Module } from '@nestjs/common';
import { CommentsModule } from '../comments/comments.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { IssuesModule } from '../issues/issues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';
import { RulePreviewService } from './rule-preview.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

/**
 * Module Automation — mẫu issue + việc lặp lại (cron sinh issue định kỳ) và quy tắc khi/nếu/thì
 * (`RuleEngineService` lắng nghe sự kiện domain + cron mỗi phút cho quy tắc theo lịch).
 * Cron @nestjs/schedule cần ScheduleModule.forRoot() đăng ký toàn cục (app.module lo).
 * Import IssuesModule/CommentsModule để mọi thay đổi đi đúng luồng workflow/OCC/sự kiện.
 */
@Module({
  imports: [IssuesModule, CommentsModule, IntegrationsModule, NotificationsModule],
  controllers: [AutomationController, RulesController],
  providers: [AutomationService, RulesService, RuleEngineService, RulePreviewService],
  exports: [AutomationService, RulesService],
})
export class AutomationModule {}
