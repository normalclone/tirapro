/** Kết quả render của mọi template email. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Escape mọi giá trị người dùng đưa vào HTML (tên workspace, tiêu đề issue…) — chống chèn HTML vào email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Chỉ cho phép liên kết http(s) — tránh `javascript:` lọt vào nút CTA. */
export function safeUrl(value: unknown): string {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '#';
}

/** Đọc chuỗi từ payload JSON tuỳ ý (payload lấy lại từ DB nên không tin kiểu). */
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Khung HTML tối giản: một cột, không ảnh, một nút CTA. `bodyHtml` PHẢI đã được escape bởi nơi gọi.
 */
export function layout(opts: { heading: string; bodyHtml: string; ctaLabel: string; ctaUrl: string; footer: string }): string {
  const url = escapeHtml(safeUrl(opts.ctaUrl));
  return `<!doctype html>
<html lang="vi">
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4;">${escapeHtml(opts.heading)}</h1>
      ${opts.bodyHtml}
      <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:10px 20px;background:#3b5bdb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(opts.ctaLabel)}</a></p>
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">Nếu nút không bấm được, hãy dán liên kết này vào trình duyệt:</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;"><a href="${url}" style="color:#3b5bdb;">${url}</a></p>
    </td></tr>
    <tr><td style="padding:12px 28px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escapeHtml(opts.footer)}</td></tr>
  </table>
</body>
</html>`;
}
