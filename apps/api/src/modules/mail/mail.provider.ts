export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Nhà cung cấp gửi thư. Lỗi → ném exception; outbox sẽ thử lại theo lịch. */
export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
}

/** Token DI của provider đang dùng (chọn theo `MAIL_DRIVER`). */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
