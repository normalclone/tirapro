import ExcelJS from 'exceljs';
import { EXCEL_IMPORT_MAX_ROWS } from '@tirapro/shared';
import { BusinessRuleException } from '../../../common/exceptions/app.exception';
import {
  EXCEL_COLUMNS,
  EXCEL_SHEET_DATA,
  EXCEL_SHEET_GUIDE,
  EXCEL_SHEET_LISTS,
  normalizeHeader,
  type ExcelColumnKey,
} from './excel-columns';

/** Giá trị ô đã bóc về dạng đơn giản (Date | số | chuỗi | boolean) — null nếu ô trống/lỗi. */
export type CellScalar = string | number | boolean | Date | null;

export interface RawExcelRow {
  /** Số dòng Excel thật. */
  row: number;
  cells: Record<ExcelColumnKey, CellScalar>;
}

/** Bóc giá trị thật của ô: rich text, hyperlink, kết quả công thức → scalar. */
export function cellScalar(value: ExcelJS.CellValue | undefined): CellScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((p) => p.text ?? '').join('');
    }
    if ('error' in v) return null;
    if ('formula' in v || 'sharedFormula' in v) return cellScalar(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v) return cellScalar(v.text as ExcelJS.CellValue) ?? String(v.hyperlink);
    if ('text' in v) return cellScalar(v.text as ExcelJS.CellValue);
  }
  return null;
}

/** Ô → chuỗi đã trim ('' nếu trống). Số nguyên không kèm ".0"; Date → yyyy-mm-dd (ngày lịch UTC). */
export function scalarText(v: CellScalar): string {
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export interface ParsedWorkbook {
  rows: RawExcelRow[];
}

const ZIP_MAGIC = [0x50, 0x4b];
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  '',
]);

/** Kiểm tra tệp tải lên: chỉ .xlsx (mimetype + magic bytes `PK`), ≤ 5 MB đã do multer chặn. */
export function assertXlsxUpload(
  file: { buffer?: Buffer; mimetype?: string; originalname?: string; size?: number } | undefined,
): Buffer {
  if (!file?.buffer?.length)
    throw new BusinessRuleException(
      'Thiếu tệp Excel — hãy chọn tệp .xlsx tải từ biểu mẫu rồi thử lại',
    );
  const name = file.originalname ?? '';
  const mime = (file.mimetype ?? '').toLowerCase();
  const magicOk = file.buffer.length >= 4 && ZIP_MAGIC.every((b, i) => file.buffer![i] === b);
  if (!/\.xlsx$/i.test(name) || !XLSX_MIMES.has(mime) || !magicOk)
    throw new BusinessRuleException(
      'Chỉ nhận tệp .xlsx — hãy dùng biểu mẫu Excel tải từ Tirapro (không nhận .xls, .csv hay tệp đổi đuôi)',
    );
  return file.buffer;
}

/** Đọc bảng tính thành các dòng thô theo TÊN cột (không theo vị trí). Dòng trống hoàn toàn bị bỏ. */
export async function parseExcelBuffer(buffer: Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BusinessRuleException(
      'Không đọc được tệp Excel — tệp có thể bị hỏng hoặc không phải .xlsx. Hãy tải lại biểu mẫu và điền lại',
    );
  }
  const ws =
    wb.getWorksheet(EXCEL_SHEET_DATA) ??
    wb.worksheets.find(
      (s) => s.state === 'visible' && s.name !== EXCEL_SHEET_GUIDE && s.name !== EXCEL_SHEET_LISTS,
    );
  if (!ws)
    throw new BusinessRuleException(
      `Không thấy sheet "${EXCEL_SHEET_DATA}" — hãy dùng biểu mẫu Excel tải từ Tirapro`,
    );

  // Header khớp theo tên (bỏ `*`, không phân biệt hoa/thường), cột lạ bị bỏ qua.
  const byName = new Map(EXCEL_COLUMNS.map((c) => [normalizeHeader(c.header), c.key]));
  const colOf = new Map<ExcelColumnKey, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = byName.get(normalizeHeader(scalarText(cellScalar(cell.value))));
    if (key && !colOf.has(key)) colOf.set(key, colNumber);
  });
  const missing = EXCEL_COLUMNS.filter((c) => c.required && !colOf.has(c.key)).map((c) => c.header);
  if (missing.length > 0)
    throw new BusinessRuleException(
      `Thiếu cột bắt buộc: ${missing.join(', ')} — hãy kiểm tra dòng tiêu đề (dòng 1) hoặc tải lại biểu mẫu`,
    );

  const rows: RawExcelRow[] = [];
  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = {} as Record<ExcelColumnKey, CellScalar>;
    let any = false;
    for (const def of EXCEL_COLUMNS) {
      const c = colOf.get(def.key);
      const v = c ? cellScalar(r.getCell(c).value) : null;
      cells[def.key] = v;
      if (scalarText(v) !== '') any = true;
    }
    if (any) rows.push({ row: rowNumber, cells });
  });
  if (rows.length > EXCEL_IMPORT_MAX_ROWS)
    throw new BusinessRuleException(
      `Tệp có ${rows.length} dòng dữ liệu, vượt giới hạn ${EXCEL_IMPORT_MAX_ROWS} dòng — hãy chia thành nhiều tệp`,
    );
  return { rows };
}

/** Ngày lịch → `YYYY-MM-DDT00:00:00.000Z`, hoặc null nếu không phải ngày hợp lệ. */
function calendarIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString();
}

/**
 * Ô ngày → ISO nửa đêm UTC của NGÀY LỊCH. Nhận Date (exceljs đọc ô ngày thành Date mà thành phần UTC chính là ngày
 * hiển thị — nên đọc `getUTC*`, không dùng giờ máy chủ), số serial Excel, hoặc chuỗi `dd/mm/yyyy` / `yyyy-mm-dd`.
 * Trả `undefined` nếu ô trống, `null` nếu có giá trị nhưng không hiểu được.
 */
export function parseExcelDate(v: CellScalar): string | null | undefined {
  if (v === null) return undefined;
  if (v instanceof Date) {
    return calendarIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1 || v >= 2958466) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return calendarIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof v === 'boolean') return null;
  const s = v.trim();
  if (s === '') return undefined;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) return calendarIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (ymd) return calendarIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  if (/^\d+(\.\d+)?$/.test(s)) return parseExcelDate(Number(s)); // serial dạng chữ
  return null;
}

/** Ô số → số; `undefined` nếu trống, `null` nếu không phải số (chấp nhận dấu phẩy thập phân). */
export function parseExcelNumber(v: CellScalar): number | null | undefined {
  if (v === null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v instanceof Date) return null;
  const s = v.trim();
  if (s === '') return undefined;
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
