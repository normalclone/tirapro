import { describe, expect, it } from 'vitest';
import {
  excelFileError,
  importButtonLabel,
  isFileChangedError,
  importSkipNote,
  previewIssueRows,
  previewSummaryText,
} from './excelImportView';

const rows = [
  {
    row: 2,
    summary: 'A',
    errors: [],
    warnings: [{ column: 'Nhãn', message: "Nhãn mới 'x' sẽ được tạo" }],
  },
  {
    row: 3,
    summary: 'B',
    errors: [
      { column: 'Loại việc', message: 'sai' },
      { column: 'Điểm', message: 'sai' },
    ],
    warnings: [],
  },
];

describe('excelImportView', () => {
  it('chỉ dòng lỗi: bỏ cảnh báo; mỗi lỗi một hàng, giữ số dòng Excel thật', () => {
    const only = previewIssueRows(rows, true);
    expect(only.map((r) => [r.row, r.column, r.kind])).toEqual([
      [3, 'Loại việc', 'error'],
      [3, 'Điểm', 'error'],
    ]);
    const all = previewIssueRows(rows, false);
    expect(all.map((r) => r.id)).toEqual(['2-w0', '3-e0', '3-e1']);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });
  it('tóm tắt + nhãn nút + ghi chú bỏ qua dòng lỗi', () => {
    expect(previewSummaryText({ valid: 4, invalid: 1 })).toBe('4 dòng hợp lệ · 1 dòng lỗi');
    expect(importButtonLabel(4)).toBe('Nhập 4 công việc');
    expect(importSkipNote({ valid: 4, invalid: 1 })).toContain('Bỏ qua 1 dòng lỗi');
    expect(importSkipNote({ valid: 4, invalid: 0 })).toBeNull();
    expect(importSkipNote({ valid: 0, invalid: 2 })).toContain('Không có dòng hợp lệ');
  });
  it('kiểm tệp ở client: đuôi, dung lượng, tệp trống', () => {
    expect(excelFileError({ name: 'a.xlsx', size: 10 })).toBeNull();
    expect(excelFileError({ name: 'A.XLSX', size: 10 })).toBeNull();
    expect(excelFileError({ name: 'a.csv', size: 10 })).toContain('.xlsx');
    expect(excelFileError({ name: 'a.xlsx', size: 6 * 1024 * 1024 })).toContain('5 MB');
    expect(excelFileError({ name: 'a.xlsx', size: 0 })).toContain('trống');
  });
  it('nhận ra tệp bị đổi/xoá sau khi chọn (NotReadableError)', () => {
    expect(isFileChangedError(new DOMException('x', 'NotReadableError'))).toBe(true);
    expect(isFileChangedError(new Error('khác'))).toBe(false);
    expect(isFileChangedError(null)).toBe(false);
  });
});
