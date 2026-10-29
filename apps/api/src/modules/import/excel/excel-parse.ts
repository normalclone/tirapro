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
function cellScalar(value: ExcelJS.CellValue | undefined): CellScalar {
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

/** Giới hạn giải nén (chặn zip bomb TRƯỚC khi exceljs nạp vào RAM): biểu mẫu 1000 dòng chỉ vài trăm KB XML. */
const ZIP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const ZIP_MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 100;
/** Entry lớn hơn 1 MB mà nén quá 100:1 là bất thường. */
const ZIP_RATIO_FLOOR_BYTES = 1024 * 1024;
const ZIP_MAX_RATIO = 100;
/** Số dòng (kể cả dòng chỉ có định dạng) tối đa mà sheet được phép khai báo. */
const SHEET_MAX_ROW_INDEX = 10_000;

const ZIP_TOO_BIG =
  'Tệp Excel giải nén quá lớn hoặc có cấu trúc bất thường — hãy dùng biểu mẫu tải từ Tirapro, tối đa 1000 dòng';
const ZIP_ENTRY_NAME = /^(xl\/|docProps\/|_rels\/|customXml\/|\[Content_Types\]\.xml$)/;

/**
 * Đọc central directory của zip (KHÔNG giải nén) và từ chối tệp có tổng dung lượng giải nén/số entry/tỉ lệ nén bất thường,
 * tên entry lạ hoặc chứa `..`. Kích thước khai báo không thể khai man: JSZip (exceljs dùng) kiểm lại kích thước thật khi giải nén.
 */
function assertSafeZip(buf: Buffer): void {
  const bad = (): never => {
    throw new BusinessRuleException(ZIP_TOO_BIG);
  };
  // Tìm End Of Central Directory (comment tối đa 65535 byte).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new BusinessRuleException(
      'Không đọc được tệp Excel — tệp có thể bị hỏng hoặc không phải .xlsx. Hãy tải lại biểu mẫu và điền lại',
    );
  const entries = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || off === 0xffffffff || entries > ZIP_MAX_ENTRIES) return bad(); // zip64 / quá nhiều entry
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return bad();
    const comp = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (size === 0xffffffff || comp === 0xffffffff) return bad();
    if (name.includes('..') || name.includes('\\') || !ZIP_ENTRY_NAME.test(name)) return bad();
    if (size > ZIP_MAX_ENTRY_BYTES) return bad();
    if (size > ZIP_RATIO_FLOOR_BYTES && size / Math.max(comp, 1) > ZIP_MAX_RATIO) return bad();
    total += size;
    if (total > ZIP_MAX_TOTAL_BYTES) return bad();
    off += 46 + nameLen + extraLen + commentLen;
  }
}

/** Đọc bảng tính thành các dòng thô theo TÊN cột (không theo vị trí). Dòng trống hoàn toàn bị bỏ. */
export async function parseExcelBuffer(buffer: Buffer): Promise<ParsedWorkbook> {
  assertSafeZip(buffer);
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

  if (ws.rowCount > SHEET_MAX_ROW_INDEX)
    throw new BusinessRuleException(
      `Sheet khai báo tới dòng ${ws.rowCount}, vượt giới hạn — hãy xoá các dòng thừa (kể cả dòng chỉ có định dạng) hoặc dùng biểu mẫu mới, tối đa ${EXCEL_IMPORT_MAX_ROWS} dòng dữ liệu`,
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
