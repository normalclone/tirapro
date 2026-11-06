import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { LinkCodesService } from './link-codes.service';
import { TelegramNotifier } from './telegram-notifier.service';
import { TelegramPersonalController } from './telegram-personal.controller';
import { TelegramPersonalService } from './telegram-personal.service';
import { TelegramService } from './telegram.service';

/**
 * Module tích hợp (Telegram...). Degrade-graceful: thiếu bot token → tính năng tắt,
 * endpoint vẫn trả 200. Producer lắng nghe domain event để đẩy thông báo ra kênh.
 */
@Module({
  controllers: [IntegrationsController, TelegramPersonalController],
  providers: [
    IntegrationsService,
    LinkCodesService,
    TelegramService,
    TelegramPersonalService,
    TelegramNotifier,
  ],
  exports: [IntegrationsService, TelegramService, TelegramNotifier],
})
export class IntegrationsModule {}
