import { escapeHtml, layout, safeUrl, str, type RenderedMail } from './layout';

interface DigestMailSection {
  title: string;
  lines: string[];
}

/** Payload lấy lại từ DB (JSON) nên không tin kiểu: chỉ giữ khối có tiêu đề và ít nhất một dòng chữ. */
function toSections(payload: Record<string, unknown>): DigestMailSection[] {
  if (!Array.isArray(payload.sections)) return [];
  const out: DigestMailSection[] = [];
  for (const raw of payload.sections as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const lines = Array.isArray(s.lines)
      ? (s.lines as unknown[]).filter((l): l is string => typeof l === 'string')
      : [];
    if (lines.length === 0) continue;
    out.push({ title: str(s.title), lines });
  }
  return out;
}

/**
 * Thư báo cáo định kỳ (digest). Nội dung là VĂN BẢN THUẦN, escape HTML đúng một lần ở đây; bản text giữ nguyên ký tự.
 * Mỗi người nhận một thư (không lộ danh sách người nhận).
 */
export function render(payload: Record<string, unknown>): RenderedMail {
  const title = str(payload.title, 'Báo cáo định kỳ');
  const subtitle = str(payload.subtitle);
  const createdBy = str(payload.createdBy);
  const sections = toSections(payload);
  const ctaUrl = safeUrl(payload.url);
  const footer = `Bạn nhận báo cáo định kỳ này${createdBy ? ` vì ${createdBy} đã thêm bạn làm người nhận` : ''} — kể cả khi bạn đã tắt email thông báo.`;

  const subtitleHtml = subtitle
    ? `<p style="margin:0 0 12px;font-size:14px;color:#6b7280;">${escapeHtml(subtitle)}</p>`
    : '';
  const sectionsHtml = sections
    .map(
      (s) =>
        `<h2 style="margin:16px 0 6px;font-size:15px;">${escapeHtml(s.title)}</h2>` +
        `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;">${s.lines
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join('')}</ul>`,
    )
    .join('');

  const text = [
    title,
    subtitle,
    ...sections.flatMap((s) => ['', s.title, ...s.lines.map((l) => `• ${l}`)]),
    '',
    `Mở trong Tirapro: ${ctaUrl}`,
    '',
    footer,
    '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  return {
    subject: title,
    html: layout({
      heading: title,
      bodyHtml: subtitleHtml + sectionsHtml,
      ctaLabel: 'Mở Tirapro',
      ctaUrl,
      footer,
    }),
    text,
  };
}
