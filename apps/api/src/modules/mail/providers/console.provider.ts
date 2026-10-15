import { Logger } from '@nestjs/common';
import type { MailMessage, MailProvider } from '../mail.provider';

/**
 * Provider dev: không gửi thật, chỉ ghi nội dung thư (bản text, có chứa liên kết) ra log.
 * Không dùng ở production — log sẽ chứa liên kết mời / đặt lại mật khẩu còn hiệu lực.
 */
export class ConsoleMailProvider implements MailProvider {
  private readonly logger = new Logger('MailConsole');

  constructor(private readonly from: string) {}

  send(msg: MailMessage): Promise<void> {
    this.logger.log(
      `[email giả lập] từ: ${this.from} | tới: ${msg.to} | chủ đề: ${msg.subject}\n${msg.text}`,
    );
    return Promise.resolve();
  }
}
