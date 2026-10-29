import { EXCEL_IMPORT_MAX_ROWS } from '@tirapro/shared';

/** Khoá nội bộ của từng cột trong biểu mẫu (thứ tự = thứ tự cột trong tệp). */
export type ExcelColumnKey =
  | 'summary'
  | 'description'
  | 'type'
  | 'priority'
  | 'status'
  | 'assignee'
  | 'reporter'
  | 'sprint'
  | 'epic'
  | 'labels'
  | 'points'
  | 'startDate'
  | 'dueDate'
  | 'components'
  | 'version';

/** Danh sách nguồn của drop-list — mỗi danh sách là MỘT cột trong sheet ẩn `DanhSach`. */
export type ExcelListKey =
  | 'type'
  | 'priority'
  | 'status'
  | 'member'
  | 'sprint'
  | 'epic'
  | 'label'
  | 'component'
  | 'version';

export interface ExcelColumnDef {
  key: ExcelColumnKey;
  /** Tiêu đề tiếng Việt, KHÔNG kèm dấu `*`. */
  header: string;
  required: boolean;
  kind: 'text' | 'list' | 'multi' | 'number' | 'date';
  /** Drop-list lấy từ danh sách nào (cột `list` / `multi`). */
  list?: ExcelListKey;
  width: number;
  /** Ghi chú hướng dẫn gắn vào ô tiêu đề. */
  note: string;
}

export const EXCEL_SHEET_DATA = 'Công việc';
export const EXCEL_SHEET_GUIDE = 'Hướng dẫn';
export const EXCEL_SHEET_LISTS = 'DanhSach';
/** Dòng dữ liệu đầu/cuối được áp validation (1000 dòng: 2..1001). */
export const EXCEL_FIRST_ROW = 2;
export const EXCEL_LAST_ROW = EXCEL_FIRST_ROW + EXCEL_IMPORT_MAX_ROWS - 1;

export const EXCEL_COLUMNS: readonly ExcelColumnDef[] = [
  {
    key: 'summary',
    header: 'Tiêu đề',
    required: true,
    kind: 'text',
    width: 42,
    note: 'Bắt buộc. Tối đa 255 ký tự.',
  },
  {
    key: 'description',
    header: 'Mô tả',
    required: false,
    kind: 'text',
    width: 48,
    note: 'Không bắt buộc. Viết được Markdown.',
  },
  {
    key: 'type',
    header: 'Loại việc',
    required: true,
    kind: 'list',
    list: 'type',
    width: 16,
    note: 'Bắt buộc. Chọn từ danh sách thả xuống.',
  },
  {
    key: 'priority',
    header: 'Ưu tiên',
    required: false,
    kind: 'list',
    list: 'priority',
    width: 14,
    note: 'Chọn từ danh sách. Bỏ trống = ưu tiên mặc định.',
  },
  {
    key: 'status',
    header: 'Trạng thái',
    required: false,
    kind: 'list',
    list: 'status',
    width: 18,
    note: 'Chọn từ danh sách. Bỏ trống = trạng thái đầu của quy trình.',
  },
  {
    key: 'assignee',
    header: 'Người phụ trách',
    required: false,
    kind: 'list',
    list: 'member',
    width: 32,
    note: 'Chọn thành viên dự án (dạng "Tên <email>") hoặc gõ email.',
  },
  {
    key: 'reporter',
    header: 'Người báo cáo',
    required: false,
    kind: 'list',
    list: 'member',
    width: 32,
    note: 'Chọn thành viên dự án. Bỏ trống = người nhập tệp.',
  },
  {
    key: 'sprint',
    header: 'Sprint',
    required: false,
    kind: 'list',
    list: 'sprint',
    width: 22,
    note: 'Sprint đang chạy hoặc sắp tới. Bỏ trống = Việc chờ.',
  },
  {
    key: 'epic',
    header: 'Epic',
    required: false,
    kind: 'list',
    list: 'epic',
    width: 34,
    note: 'Chọn epic của dự án (dạng "KEY — tiêu đề") hoặc gõ mã epic.',
  },
  {
    key: 'labels',
    header: 'Nhãn',
    required: false,
    kind: 'multi',
    list: 'label',
    width: 24,
    note: 'Nhiều nhãn cách nhau dấu ";". Nhãn chưa có sẽ được tạo mới.',
  },
  {
    key: 'points',
    header: 'Điểm',
    required: false,
    kind: 'number',
    width: 10,
    note: 'Số từ 0 đến 1000 (cho phép số thập phân).',
  },
  {
    key: 'startDate',
    header: 'Ngày bắt đầu',
    required: false,
    kind: 'date',
    width: 16,
    note: 'Định dạng dd/mm/yyyy, ví dụ 15/03/2026.',
  },
  {
    key: 'dueDate',
    header: 'Hạn hoàn thành',
    required: false,
    kind: 'date',
    width: 16,
    note: 'Định dạng dd/mm/yyyy. Phải sau hoặc bằng Ngày bắt đầu.',
  },
  {
    key: 'components',
    header: 'Thành phần',
    required: false,
    kind: 'multi',
    list: 'component',
    width: 24,
    note: 'Nhiều thành phần cách nhau dấu ";". Phải là thành phần đã có của dự án.',
  },
  {
    key: 'version',
    header: 'Phiên bản',
    required: false,
    kind: 'list',
    list: 'version',
    width: 18,
    note: 'Phiên bản chưa phát hành (fix version).',
  },
];

/** Cột của sheet `DanhSach` theo thứ tự (A, B, C…) + tiêu đề. */
export const EXCEL_LIST_DEFS: ReadonlyArray<{ key: ExcelListKey; title: string }> = [
  { key: 'type', title: 'Loại việc' },
  { key: 'priority', title: 'Ưu tiên' },
  { key: 'status', title: 'Trạng thái' },
  { key: 'member', title: 'Thành viên' },
  { key: 'sprint', title: 'Sprint' },
  { key: 'epic', title: 'Epic' },
  { key: 'label', title: 'Nhãn' },
  { key: 'component', title: 'Thành phần' },
  { key: 'version', title: 'Phiên bản' },
];

/** Chuẩn hoá tiêu đề cột để so khớp: bỏ `*`, gom khoảng trắng, không phân biệt hoa/thường/dạng Unicode. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('vi');
}

export const personLabel = (u: { displayName: string; email: string }): string =>
  `${u.displayName} <${u.email}>`;

export const epicLabel = (e: { key: string; summary: string }): string => `${e.key} — ${e.summary}`;

/** Danh sách mà người dùng gõ nhiều giá trị: tách theo `;`, bỏ rỗng, bỏ trùng (không phân biệt hoa/thường). */
export function splitMulti(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(';')) {
    const v = part.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}
