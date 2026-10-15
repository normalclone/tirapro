import type { MailMessage, MailProvider } from '../mail.provider';

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Provider SMTP — mới là khung: chưa cài nodemailer nên chưa gửi thật.
 * Chọn `MAIL_DRIVER=smtp` mà thiếu cấu hình thì ném lỗi ngay lúc khởi động để người vận hành biết sớm.
 */
export class SmtpMailProvider implements MailProvider {
  constructor(private readonly settings: Partial<SmtpSettings>) {
    if (!settings.host) {
      throw new Error(
        'MAIL_DRIVER=smtp nhưng chưa cấu hình SMTP — hãy đặt SMTP_HOST (và SMTP_PORT, SMTP_USER, SMTP_PASS) hoặc dùng MAIL_DRIVER=console.',
      );
    }
  }

  send(_msg: MailMessage): Promise<void> {
    return Promise.reject(
      new Error(
        'Gửi qua SMTP chưa được hỗ trợ trong bản này (chưa cài thư viện gửi thư) — hãy dùng MAIL_DRIVER=console.',
      ),
    );
  }
}
