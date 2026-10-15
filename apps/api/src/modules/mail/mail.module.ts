import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailAdminController } from './mail-admin.controller';
import { MailOutboxService } from './mail-outbox.service';
import { MAIL_PROVIDER, type MailProvider } from './mail.provider';
import { MailService } from './mail.service';
import { ConsoleMailProvider } from './providers/console.provider';
import { SmtpMailProvider } from './providers/smtp.provider';

/**
 * Hạ tầng email dùng chung (@Global): `MailService.enqueue` ghi outbox, cron `MailOutboxService` gửi.
 * Provider chọn theo `MAIL_DRIVER`; thiếu cấu hình SMTP thì ném lỗi ngay lúc khởi động.
 */
@Global()
@Module({
  controllers: [MailAdminController],
  providers: [
    MailService,
    MailOutboxService,
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailProvider => {
        const from = config.get<string>('mail.from') ?? 'Tirapro <no-reply@tirapro.local>';
        if (config.get<string>('mail.driver') === 'smtp') {
          return new SmtpMailProvider({
            ...config.get<{ host: string; port: number; user: string; pass: string }>('mail.smtp'),
            from,
          });
        }
        if (config.get<boolean>('isProd')) {
          new Logger('MailModule').warn(
            'MAIL_DRIVER=console ở production: thư KHÔNG được gửi thật và log API sẽ chứa liên kết đặt lại mật khẩu. Hãy cấu hình SMTP khi sẵn sàng.',
          );
        }
        return new ConsoleMailProvider(from);
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
