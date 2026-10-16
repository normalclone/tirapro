import { toast } from 'sonner';
import { downloadFile } from '@/lib/download';
import type { ResultColumnId } from '@/features/saved-filters/resultColumns';

/** Trần dòng của máy chủ (`CSV_MAX_ROWS` ở api/export/export.service.ts) — chỉ để nói với người dùng. */
const EXPORT_ROW_CAP = 5000;

/** Cột xuất = id cột của bảng kết quả JQL + vài cột chỉ có ở file xuất (máy chủ bỏ id lạ, luôn có `key`). */
type ExportColumnId = ResultColumnId | 'start' | 'sprint' | 'labels' | 'created';

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
function exportIssuesCsv(
  input: ExportIssuesCsvInput,
): Promise<{ filename: string; truncated: boolean; rows: number | null; saved: boolean }> {
  return downloadFile('/export/issues.csv', {
    params: issuesCsvParams(input),
    fallbackName: 'tirapro-cong-viec.csv',
    skipIfEmpty: true,
  });
}

/** Câu báo khi không có công việc nào để xuất (không tải file chỉ có dòng tiêu đề). */
export function exportEmptyMessage(input: Pick<ExportIssuesCsvInput, 'sprintId'>): string {
  return input.sprintId ? 'Sprint chưa có việc nào để xuất.' : 'Không có công việc nào để xuất.';
}

/**
 * Câu báo sau khi tải: cảnh báo khi file bị cắt ở trần, ngược lại xác nhận ngắn.
 * Chỉ khuyên "thu hẹp bộ lọc" khi nơi xuất CÓ bộ lọc (JQL); Việc chờ / bug / sprint không có bộ lọc để thu hẹp.
 */
export function exportResultToast(
  truncated: boolean,
  hasFilter = false,
): {
  kind: 'warning' | 'success';
  text: string;
} {
  if (!truncated) return { kind: 'success', text: 'Đã tải tệp CSV.' };
  const head = `Chỉ xuất ${EXPORT_ROW_CAP.toLocaleString('vi-VN')} công việc đầu tiên`;
  return {
    kind: 'warning',
    text: hasFilter ? `${head} — hãy thu hẹp bộ lọc.` : `${head} (giới hạn mỗi lần xuất).`,
  };
}

/** `exportIssuesCsv` + toast kết quả; lỗi ném lên cho `ExportMenu` hiện toast lỗi. */
export async function exportIssuesCsvWithToast(input: ExportIssuesCsvInput): Promise<void> {
  const { truncated, saved } = await exportIssuesCsv(input);
  if (!saved) {
    toast.info(exportEmptyMessage(input));
    return;
  }
  const t = exportResultToast(truncated, !!input.jql?.trim());
  if (t.kind === 'warning') toast.warning(t.text);
  else toast.success(t.text);
}
