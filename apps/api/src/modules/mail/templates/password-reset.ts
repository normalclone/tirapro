import { escapeHtml, layout, safeUrl, str, type RenderedMail } from './layout';

export interface PasswordResetMailPayload {
  displayName?: string;
  resetUrl: string;
}

/** Thư đặt lại mật khẩu — liên kết dùng một lần, hết hạn sau 1 giờ. */
export function render(payload: Record<string, unknown>): RenderedMail {
  const name = str(payload.displayName);
  const resetUrl = safeUrl(payload.resetUrl);
  const greeting = name ? `Chào ${name},` : 'Chào bạn,';
  const intro = `${greeting} chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Tirapro của bạn. Bấm nút bên dưới để chọn mật khẩu mới.`;
  return {
    subject: 'Đặt lại mật khẩu Tirapro',
    html: layout({
      heading: 'Đặt lại mật khẩu',
      bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>`,
      ctaLabel: 'Đặt lại mật khẩu',
      ctaUrl: resetUrl,
      footer: 'Liên kết dùng được một lần và hết hạn sau 1 giờ. Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu của bạn không thay đổi.',
    }),
    text: `${intro}\n\nĐặt lại mật khẩu: ${resetUrl}\n\nLiên kết dùng được một lần và hết hạn sau 1 giờ. Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu của bạn không thay đổi.\n`,
  };
}
