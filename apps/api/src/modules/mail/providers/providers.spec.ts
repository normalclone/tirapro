import { describe, expect, it } from 'vitest';
import { ConsoleMailProvider } from './console.provider';
import { SmtpMailProvider } from './smtp.provider';

describe('mail providers', () => {
  it('SMTP thiếu cấu hình → ném lỗi tiếng Việt "chưa cấu hình SMTP" ngay khi khởi tạo', () => {
    expect(() => new SmtpMailProvider({})).toThrow(/chưa cấu hình SMTP/);
  });

  it('SMTP đủ cấu hình nhưng chưa có thư viện gửi → send báo lỗi rõ ràng (outbox sẽ thử lại)', async () => {
    const p = new SmtpMailProvider({ host: 'smtp.local', port: 587 });
    await expect(p.send({ to: 'a@x.vn', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /chưa được hỗ trợ/,
    );
  });

  it('console: send resolve, không gửi thật', async () => {
    const p = new ConsoleMailProvider('Tirapro <no-reply@tirapro.local>');
    await expect(
      p.send({ to: 'a@x.vn', subject: 's', html: 'h', text: 't' }),
    ).resolves.toBeUndefined();
  });
});
