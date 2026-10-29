import {
  EXCEL_IMPORT_MAX_BYTES,
  type ExcelPreviewResult,
  type ExcelPreviewRow,
} from '@tirapro/shared';

/** Một dòng trong bảng xem trước = một lỗi/cảnh báo của một dòng Excel. */
export interface PreviewIssueRow {
  id: string;
  row: number;
  summary: string;
  column: string;
  message: string;
  kind: 'error' | 'warning';
}

/** Số dòng tối đa vẽ ra bảng (tệp 1000 dòng toàn lỗi vẫn nhẹ); phần còn lại báo "và N mục nữa". */
export const PREVIEW_TABLE_LIMIT = 200;

/** Làm phẳng lỗi/cảnh báo của các dòng. `onlyErrors`: bỏ cảnh báo (nhãn mới sẽ được tạo…). */
export function previewIssueRows(
  rows: readonly ExcelPreviewRow[],
  onlyErrors: boolean,
): PreviewIssueRow[] {
  const out: PreviewIssueRow[] = [];
  for (const r of rows) {
    r.errors.forEach((e, i) =>
      out.push({
        id: `${r.row}-e${i}`,
        row: r.row,
        summary: r.summary,
        column: e.column,
        message: e.message,
        kind: 'error',
      }),
    );
    if (!onlyErrors)
      r.warnings.forEach((e, i) =>
        out.push({
          id: `${r.row}-w${i}`,
          row: r.row,
          summary: r.summary,
          column: e.column,
          message: e.message,
          kind: 'warning',
        }),
      );
  }
  return out;
}

/** "N dòng hợp lệ · M dòng lỗi". */
export function previewSummaryText(p: Pick<ExcelPreviewResult, 'valid' | 'invalid'>): string {
  return `${p.valid} dòng hợp lệ · ${p.invalid} dòng lỗi`;
}

/** Nhãn nút chính: "Nhập N công việc" (+ ghi rõ bỏ qua M dòng lỗi qua `importSkipNote`). */
export function importButtonLabel(valid: number): string {
  return `Nhập ${valid} công việc`;
}

export function importSkipNote(p: Pick<ExcelPreviewResult, 'valid' | 'invalid'>): string | null {
  if (p.valid === 0) return 'Không có dòng hợp lệ để nhập — hãy sửa tệp rồi chọn lại.';
  if (p.invalid > 0) return `Bỏ qua ${p.invalid} dòng lỗi (sửa trong tệp rồi nhập lại sau).`;
  return null;
}

/** Kiểm tệp ở trình duyệt trước khi gửi: trả câu lỗi tiếng Việt hoặc null. Máy chủ vẫn kiểm lại. */
export function excelFileError(file: { name: string; size: number }): string | null {
  if (!/\.xlsx$/i.test(file.name))
    return 'Chỉ nhận tệp .xlsx — hãy dùng biểu mẫu Excel tải từ Tirapro.';
  if (file.size > EXCEL_IMPORT_MAX_BYTES)
    return 'Tệp lớn hơn 5 MB — hãy chia thành nhiều tệp nhỏ hơn.';
  if (file.size === 0) return 'Tệp trống — hãy chọn tệp đã điền dữ liệu.';
  return null;
}

/** Lỗi khi gửi/đọc tệp: tệp bị sửa/xoá trên đĩa sau khi chọn → câu rõ ràng thay vì thông báo lạ của trình duyệt. */
export function isFileChangedError(e: unknown): boolean {
  // Qua axios lỗi bị bọc thành AxiosError (name 'AxiosError'), DOMException gốc nằm ở `cause` → đi dọc chuỗi cause.
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur; depth++) {
    const name = (cur as { name?: string }).name;
    if (name === 'NotReadableError' || name === 'NotFoundError') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export const FILE_CHANGED_MESSAGE = 'Tệp đã thay đổi hoặc không đọc được — hãy chọn lại tệp.';
