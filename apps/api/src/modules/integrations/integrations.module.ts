import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { TelegramService } from './telegram.service';

/**
 * Module tích hợp (Telegram...). Degrade-graceful: thiếu bot token → tính năng tắt,
 * endpoint vẫn trả 200. Producer lắng nghe domain event để đẩy thông báo ra kênh.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, TelegramService],
  exports: [IntegrationsService, TelegramService],
})
export class IntegrationsModule {}
