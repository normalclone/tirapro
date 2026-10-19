import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MailModule } from '../mail/mail.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DigestsController } from './digests.controller';
import { DigestsService } from './digests.service';

/**
 * Module Digests — báo cáo/digest định kỳ (subscription). Degrade-graceful:
 * thiếu kênh/token Telegram → không gửi (sent=false), KHÔNG ném lỗi.
 * Cron @nestjs/schedule cần ScheduleModule.forRoot() đăng ký toàn cục (do app.module lo).
 * Import IntegrationsModule để inject TelegramService (gửi digest qua Telegram) và AnalyticsModule
 * (LeadershipService + ProjectHealthService cho các khối rủi ro/OKR/nhân lực/sức khoẻ).
 */
@Module({
  imports: [IntegrationsModule, AnalyticsModule, MailModule],
  controllers: [DigestsController],
  providers: [DigestsService],
  exports: [DigestsService],
})
export class DigestsModule {}
