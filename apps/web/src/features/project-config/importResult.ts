import type { ImportResult } from './api';

/** Thông báo kết quả import: số việc đã nhập / lỗi, kèm số người phụ trách không còn trong workspace (đã bỏ gán) khi > 0. */
export function importResultMessage(
  result: Pick<ImportResult, 'created' | 'failed' | 'total' | 'skippedAssignees'>,
): { level: 'success' | 'warning'; text: string } {
  const { created, failed, total } = result;
  const skipped = result.skippedAssignees ?? 0;
  const base =
    failed > 0
      ? `Đã nhập ${created}/${total} công việc · ${failed} việc lỗi.`
      : `Đã nhập thành công ${created}/${total} công việc.`;
  const note =
    skipped > 0
      ? ` ${skipped} người phụ trách không còn trong workspace — đã bỏ gán (việc vẫn được nhập).`
      : '';
  return { level: failed > 0 || skipped > 0 ? 'warning' : 'success', text: base + note };
}
