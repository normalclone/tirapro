import { toast } from 'sonner';
import { downloadFile } from '@/lib/download';
import type { ResultColumnId } from '@/features/saved-filters/resultColumns';

/** Trần dòng của máy chủ (`CSV_MAX_ROWS` ở api/export/export.service.ts) — chỉ để nói với người dùng. */
export const EXPORT_ROW_CAP = 5000;

/** Cột xuất = id cột của bảng kết quả JQL + vài cột chỉ có ở file xuất (máy chủ bỏ id lạ, luôn có `key`). */
export type ExportColumnId = ResultColumnId | 'start' | 'sprint' | 'labels' | 'created';

export interface ExportIssuesCsvInput {
  jql?: string;
  projectId?: string;
  /** `backlog` = việc chưa Done và chưa vào sprint; `bugs` = loại Bug. Cần `projectId`. */
  preset?: 'backlog' | 'bugs';
  sprintId?: string;
  /** Không truyền = đủ cột. */
  columns?: ExportColumnId[];
  delimiter?: 'comma' | 'semicolon';
}

/** Tham số query của `GET /export/issues.csv` (bỏ giá trị rỗng). Thuần để test được. */
export function issuesCsvParams(input: ExportIssuesCsvInput): Record<string, string> {
  const params: Record<string, string> = {};
  if (input.jql?.trim()) params.jql = input.jql.trim();
  if (input.projectId) params.projectId = input.projectId;
  if (input.preset) params.preset = input.preset;
  if (input.sprintId) params.sprintId = input.sprintId;
  if (input.columns?.length) params.columns = input.columns.join(',');
  if (input.delimiter) params.delimiter = input.delimiter;
  return params;
}

/** Tải CSV công việc từ máy chủ (đủ mọi dòng, không bị cắt ở trang đã tải). */
export function exportIssuesCsv(
  input: ExportIssuesCsvInput,
): Promise<{ filename: string; truncated: boolean }> {
  return downloadFile('/export/issues.csv', {
    params: issuesCsvParams(input),
    fallbackName: 'tirapro-cong-viec.csv',
  });
}

/** Câu báo sau khi tải: cảnh báo khi file bị cắt ở trần, ngược lại xác nhận ngắn. */
export function exportResultToast(truncated: boolean): {
  kind: 'warning' | 'success';
  text: string;
} {
  return truncated
    ? {
        kind: 'warning',
        text: `Chỉ xuất ${EXPORT_ROW_CAP.toLocaleString('vi-VN')} công việc đầu tiên — hãy thu hẹp bộ lọc.`,
      }
    : { kind: 'success', text: 'Đã tải tệp CSV.' };
}

/** `exportIssuesCsv` + toast kết quả; lỗi ném lên cho `ExportMenu` hiện toast lỗi. */
export async function exportIssuesCsvWithToast(input: ExportIssuesCsvInput): Promise<void> {
  const { truncated } = await exportIssuesCsv(input);
  const t = exportResultToast(truncated);
  if (t.kind === 'warning') toast.warning(t.text);
  else toast.success(t.text);
}
