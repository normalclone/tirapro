import { escapeHtml, layout, safeUrl, str, type RenderedMail } from './layout';

export interface InviteMailPayload {
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
}

/** Thư mời tham gia workspace — liên kết dùng một lần, hết hạn sau 7 ngày. */
export function render(payload: Record<string, unknown>): RenderedMail {
  const workspaceName = str(payload.workspaceName, 'không gian làm việc');
  const inviterName = str(payload.inviterName, 'Một đồng nghiệp');
  const acceptUrl = safeUrl(payload.acceptUrl);
  const subject = `${inviterName} mời bạn tham gia ${workspaceName} trên Tirapro`;
  const intro = `${inviterName} đã mời bạn tham gia "${workspaceName}". Bấm nút bên dưới để đặt tên hiển thị, mật khẩu và vào làm việc.`;
  return {
    subject,
    html: layout({
      heading: `Bạn được mời vào ${workspaceName}`,
      bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>`,
      ctaLabel: 'Chấp nhận lời mời',
      ctaUrl: acceptUrl,
      footer:
        'Liên kết dùng được một lần và hết hạn sau 7 ngày. Nếu bạn không mong đợi thư này, cứ bỏ qua nó.',
    }),
    text: `${intro}\n\nChấp nhận lời mời: ${acceptUrl}\n\nLiên kết dùng được một lần và hết hạn sau 7 ngày. Nếu bạn không mong đợi thư này, cứ bỏ qua nó.\n`,
  };
}
