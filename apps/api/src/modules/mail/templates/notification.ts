import { escapeHtml, layout, safeUrl, str, type RenderedMail } from './layout';

export interface NotificationItem {
  title: string;
  body: string;
  url: string;
}

/** Payload hợp lệ: một mục `{title, body, url}` hoặc nhiều mục `{items}` (digest 5 phút). */
export function toItems(payload: Record<string, unknown>): NotificationItem[] {
  const raw = Array.isArray(payload.items) ? (payload.items as unknown[]) : [payload];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ title: str(x.title, 'Thông báo mới'), body: str(x.body), url: str(x.url) }));
}

/** Thư thông báo — một mục hoặc digest gộp nhiều mục. */
export function render(payload: Record<string, unknown>): RenderedMail {
  const items = toItems(payload);
  const first = items[0] ?? { title: 'Thông báo mới', body: '', url: '' };
  const ctaUrl = safeUrl(first.url);

  if (items.length <= 1) {
    return {
      subject: first.title,
      html: layout({
        heading: first.title,
        bodyHtml: first.body ? `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(first.body)}</p>` : '',
        ctaLabel: 'Mở trong Tirapro',
        ctaUrl,
        footer: 'Bạn nhận thư này vì đã bật thông báo qua email. Tắt ở Cài đặt → Thông báo.',
      }),
      text: `${first.title}\n${first.body ? `\n${first.body}\n` : ''}\nMở trong Tirapro: ${ctaUrl}\n\nTắt thông báo qua email ở Cài đặt → Thông báo.\n`,
    };
  }

  const listHtml = items
    .map((it) => {
      const href = escapeHtml(safeUrl(it.url));
      const body = it.body ? `<br><span style="color:#6b7280;">${escapeHtml(it.body)}</span>` : '';
      return `<li style="margin:0 0 10px;"><a href="${href}" style="color:#3b5bdb;font-weight:600;text-decoration:none;">${escapeHtml(it.title)}</a>${body}</li>`;
    })
    .join('');
  return {
    subject: `Bạn có ${items.length} thông báo mới trên Tirapro`,
    html: layout({
      heading: `Bạn có ${items.length} thông báo mới`,
      bodyHtml: `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;">${listHtml}</ul>`,
      ctaLabel: 'Mở Tirapro',
      ctaUrl,
      footer: 'Bạn nhận thư này vì đã bật thông báo qua email. Tắt ở Cài đặt → Thông báo.',
    }),
    text:
      items.map((it) => `- ${it.title}${it.body ? ` — ${it.body}` : ''}\n  ${safeUrl(it.url)}`).join('\n') +
      '\n\nTắt thông báo qua email ở Cài đặt → Thông báo.\n',
  };
}
