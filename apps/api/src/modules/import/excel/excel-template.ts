import ExcelJS from 'exceljs';
import { EXCEL_IMPORT_MAX_ROWS, formatVnDateTime } from '@tirapro/shared';
import {
  EXCEL_COLUMNS,
  EXCEL_FIRST_ROW,
  EXCEL_LAST_ROW,
  EXCEL_LIST_DEFS,
  EXCEL_SHEET_DATA,
  EXCEL_SHEET_GUIDE,
  EXCEL_SHEET_LISTS,
  epicLabel,
  personLabel,
  type ExcelListKey,
} from './excel-columns';

/** Dữ liệu cấu hình dự án mà cả drop-list lẫn bước kiểm tra tệp tải lên cùng dựa vào. */
export interface ProjectCatalog {
  project: { id: string; key: string; name: string };
  types: Array<{
    id: string;
    name: string;
    key: string | null;
    hierarchyLevel: number;
    isSubtask: boolean;
  }>;
  priorities: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string; isInitial: boolean }>;
  members: Array<{ id: string; displayName: string; email: string }>;
  sprints: Array<{ id: string; name: string }>;
  epics: Array<{ id: string; key: string; summary: string }>;
  labels: Array<{ id: string; name: string }>;
  components: Array<{ id: string; name: string }>;
  versions: Array<{ id: string; name: string }>;
}

/** Cột list cho gõ tay (email / mã epic) — validation `warning` thay vì `stop`. */
const SOFT_LIST_COLUMNS = new Set(['assignee', 'reporter', 'epic']);

const REQUIRED_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF4D6' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE9EEF5' },
};
const REQUIRED_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFE3A3' },
};

/** Giá trị hiển thị của từng drop-list (đúng thứ tự dùng để ghi vào sheet ẩn). */
function listValues(catalog: ProjectCatalog): Record<ExcelListKey, string[]> {
  const clean = (xs: string[]): string[] => xs.filter((x) => x.trim() !== '' && !x.includes(';'));
  return {
    // Loại việc con (sub-task) cần việc cha — biểu mẫu không có cột đó nên không đưa vào danh sách.
    type: clean(catalog.types.filter((t) => !t.isSubtask).map((t) => t.name)),
    priority: clean(catalog.priorities.map((p) => p.name)),
    status: clean(catalog.statuses.map((s) => s.name)),
    member: clean(catalog.members.map(personLabel)),
    sprint: clean(catalog.sprints.map((s) => s.name)),
    epic: clean(catalog.epics.map(epicLabel)),
    label: clean(catalog.labels.map((l) => l.name)),
    component: clean(catalog.components.map((c) => c.name)),
    version: clean(catalog.versions.map((v) => v.name)),
  };
}

/** exceljs có `dataValidations` nhưng thiếu trong .d.ts. */
function addValidation(ws: ExcelJS.Worksheet, range: string, rule: Record<string, unknown>): void {
  (ws as unknown as { dataValidations: { add(a: string, v: unknown): void } }).dataValidations.add(
    range,
    rule,
  );
}

/** Chữ cái cột Excel (1 → A). Chỉ cần cho ≤ 26 cột. */
const colLetter = (n: number): string => String.fromCharCode(64 + n);

export async function buildExcelTemplate(
  catalog: ProjectCatalog,
  now: Date = new Date(),
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tirapro';
  wb.created = now;

  const ws = wb.addWorksheet(EXCEL_SHEET_DATA, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  const guide = wb.addWorksheet(EXCEL_SHEET_GUIDE);
  const lists = wb.addWorksheet(EXCEL_SHEET_LISTS);
  lists.state = 'veryHidden';

  // ---- Sheet ẩn DanhSach: mỗi danh sách một cột, tiêu đề ở dòng 1, giá trị từ dòng 2 ----
  const values = listValues(catalog);
  const listRange = new Map<ExcelListKey, string>();
  EXCEL_LIST_DEFS.forEach((def, i) => {
    const col = i + 1;
    lists.getCell(1, col).value = def.title;
    const items = values[def.key];
    items.forEach((v, r) => {
      lists.getCell(r + 2, col).value = v;
    });
    if (items.length > 0) {
      const L = colLetter(col);
      listRange.set(def.key, `${EXCEL_SHEET_LISTS}!$${L}$2:$${L}$${items.length + 1}`);
    }
  });

  // ---- Sheet dữ liệu ----
  EXCEL_COLUMNS.forEach((def, i) => {
    const col = ws.getColumn(i + 1);
    col.width = def.width;
    if (def.required) col.fill = REQUIRED_FILL;
    if (def.kind === 'date') col.numFmt = 'dd/mm/yyyy';
    if (def.kind === 'text')
      col.alignment = { vertical: 'top', wrapText: def.key === 'description' };

    const header = ws.getCell(1, i + 1);
    header.value = def.required ? `${def.header}*` : def.header;
    header.font = { bold: true };
    header.fill = def.required ? REQUIRED_HEADER_FILL : HEADER_FILL;
    header.alignment = { vertical: 'middle', wrapText: true };
    header.border = { bottom: { style: 'thin', color: { argb: 'FF8895A7' } } };
    header.note = { texts: [{ text: def.note }] };

    const range = `${colLetter(i + 1)}${EXCEL_FIRST_ROW}:${colLetter(i + 1)}${EXCEL_LAST_ROW}`;
    if ((def.kind === 'list' || def.kind === 'multi') && def.list) {
      const ref = listRange.get(def.list);
      if (ref) {
        addValidation(ws, range, {
          type: 'list',
          allowBlank: true,
          formulae: [ref],
          showErrorMessage: true,
          ...(def.kind === 'multi'
            ? {
                // Cho gõ nhiều giá trị cách nhau ";" → cảnh báo mềm, không chặn.
                errorStyle: 'information' as const,
                errorTitle: def.header,
                error:
                  def.key === 'labels'
                    ? 'Nhiều nhãn: cách nhau dấu ";". Nhãn chưa có sẽ được tạo mới.'
                    : 'Nhiều thành phần: cách nhau dấu ";". Mỗi giá trị phải là thành phần đã có của dự án.',
              }
            : SOFT_LIST_COLUMNS.has(def.key)
              ? {
                  // Người/Epic: cho gõ email hoặc mã epic trần (hướng dẫn nói vậy) → cảnh báo, người dùng vẫn bấm "Có" để giữ.
                  errorStyle: 'warning' as const,
                  errorTitle: def.header,
                  error:
                    def.key === 'epic'
                      ? 'Giá trị không có trong danh sách. Chọn "KEY — tiêu đề" hoặc gõ đúng mã epic của dự án.'
                      : 'Giá trị không có trong danh sách. Chọn "Tên <email>" hoặc gõ đúng email thành viên dự án.',
                }
              : {
                  errorStyle: 'stop' as const,
                  errorTitle: def.header,
                  error: 'Hãy chọn một giá trị trong danh sách thả xuống.',
                }),
        });
      }
    } else if (def.kind === 'number') {
      addValidation(ws, range, {
        type: 'decimal',
        operator: 'between',
        allowBlank: true,
        formulae: [0, 1000],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: def.header,
        error: 'Nhập một số từ 0 đến 1000.',
      });
    } else if (def.kind === 'date') {
      addValidation(ws, range, {
        type: 'date',
        operator: 'greaterThan',
        allowBlank: true,
        formulae: [new Date(Date.UTC(1900, 0, 1))],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: def.header,
        error: 'Nhập ngày hợp lệ theo định dạng dd/mm/yyyy.',
      });
    }
  });
  ws.getRow(1).height = 30;

  // ---- Sheet Hướng dẫn ----
  guide.getColumn(1).width = 26;
  guide.getColumn(2).width = 96;
  const lines: Array<[string, string]> = [
    ['Dự án', `${catalog.project.name} (${catalog.project.key})`],
    ['Ngày tạo biểu mẫu', formatVnDateTime(now)],
    ['', ''],
    [
      'Cách điền',
      `Điền mỗi công việc một dòng ở sheet "${EXCEL_SHEET_DATA}", bắt đầu từ dòng 2. Cột có dấu * (nền vàng nhạt) là bắt buộc: Tiêu đề, Loại việc.`,
    ],
    [
      '',
      'Các cột có mũi tên thả xuống chỉ nhận giá trị trong danh sách lấy từ cấu hình dự án. Muốn thêm giá trị mới (loại việc, sprint, thành phần…) hãy tạo trong dự án rồi tải lại biểu mẫu.',
    ],
    [
      '',
      'Không đổi tên tiêu đề cột. Thứ tự cột có thể thay đổi, nhưng tên phải giữ nguyên. Cột thừa sẽ bị bỏ qua.',
    ],
    [
      'Định dạng ngày',
      'Ngày bắt đầu và Hạn hoàn thành nhập dạng dd/mm/yyyy (ví dụ 15/03/2026); chấp nhận cả yyyy-mm-dd. Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu.',
    ],
    [
      'Nhiều giá trị',
      'Cột Nhãn và Thành phần cho nhập nhiều giá trị, cách nhau dấu chấm phẩy ";" (ví dụ: ui; backend). Nhãn chưa có sẽ được tạo mới; Thành phần phải đã có trong dự án.',
    ],
    [
      'Người',
      'Người phụ trách / Người báo cáo: chọn "Tên <email>" trong danh sách hoặc gõ email. Phải là thành viên của dự án. Người báo cáo bỏ trống = người nhập tệp.',
    ],
    ['Trạng thái', 'Bỏ trống = trạng thái đầu của quy trình dự án.'],
    [
      'Giới hạn',
      `Tệp .xlsx tối đa 5 MB, tối đa ${EXCEL_IMPORT_MAX_ROWS} dòng dữ liệu mỗi lần nhập. Dòng trống hoàn toàn được bỏ qua.`,
    ],
    [
      'Xem trước',
      'Sau khi tải tệp lên, hệ thống hiển thị lỗi từng dòng/cột. Chỉ các dòng hợp lệ được nhập; dòng lỗi bị bỏ qua — sửa trong tệp rồi nhập lại.',
    ],
  ];
  lines.forEach(([a, b], i) => {
    const r = i + 1;
    guide.getCell(r, 1).value = a;
    guide.getCell(r, 1).font = { bold: true };
    guide.getCell(r, 1).alignment = { vertical: 'top' };
    guide.getCell(r, 2).value = b;
    guide.getCell(r, 2).alignment = { vertical: 'top', wrapText: true };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
