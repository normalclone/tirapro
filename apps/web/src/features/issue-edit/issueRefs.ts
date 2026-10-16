import { matchIssueKeys } from '@tirapro/shared';
import type { WikiIssueRef } from '@/features/wiki/api';

/** Công việc đã được máy chủ xác nhận có thật, tra theo mã (để vẽ chip trong `MarkdownView`). */
export type IssueRef = WikiIssueRef;

export type IssueKeyPart = { type: 'text' | 'key'; value: string };

/**
 * Tách văn bản thành đoạn chữ và mã công việc ĐÃ BIẾT (`known`). Mã giống-mã nhưng không có trong `known`
 * (vd "UTF-8") giữ nguyên là chữ; đoạn chữ liền kề được ghép lại.
 */
export function splitIssueKeys(text: string, known: ReadonlySet<string>): IssueKeyPart[] {
  if (known.size === 0) return [{ type: 'text', value: text }];
  const parts: IssueKeyPart[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = parts[parts.length - 1];
    if (prev?.type === 'text') prev.value += value;
    else parts.push({ type: 'text', value });
  };
  for (const m of matchIssueKeys(text)) {
    if (!known.has(m.key)) continue;
    pushText(text.slice(last, m.index));
    parts.push({ type: 'key', value: m.key });
    last = m.index + m.key.length;
  }
  pushText(text.slice(last));
  return parts.length ? parts : [{ type: 'text', value: text }];
}
