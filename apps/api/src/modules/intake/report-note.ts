import { formatEnvironment, type EnvironmentInput } from '@tirapro/shared';

interface ReportNoteAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

export interface ReportNoteInput {
  reporterName: string;
  at: Date;
  description?: string | null;
  environment?: EnvironmentInput | null;
  /** Tên mức nghiêm trọng người báo đề xuất — chỉ truyền khi khác mức hiện tại của bug. */
  severityName?: string | null;
  attachments: ReportNoteAttachment[];
}

/** dd/MM/yyyy HH:mm theo giờ Việt Nam (máy chủ có thể chạy múi giờ khác). */
function formatVn(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Nội dung bình luận (Markdown) khi người báo "báo lại" một bug đã có — không bao giờ vứt chữ/ảnh của họ. */
export function buildReportNote(a: ReportNoteInput): string {
  const lines: string[] = [`*${a.reporterName} báo lại ngày ${formatVn(a.at)}*`];
  const description = a.description?.trim();
  if (description) lines.push('', description);
  const env = formatEnvironment(a.environment);
  if (env) lines.push('', `**Môi trường:** ${env}`);
  if (a.severityName) lines.push('', `**Mức nghiêm trọng đề xuất:** ${a.severityName}`);
  const images = a.attachments.filter((f) => f.mimeType.startsWith('image/'));
  const files = a.attachments.filter((f) => !f.mimeType.startsWith('image/'));
  if (images.length) lines.push('', ...images.map((f) => `![${f.fileName}](attachment:${f.id})`));
  if (files.length) lines.push('', ...files.map((f) => `Tệp: ${f.fileName}`));
  return lines.join('\n');
}
