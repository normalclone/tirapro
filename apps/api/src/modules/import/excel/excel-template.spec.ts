import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  EXCEL_COLUMNS,
  EXCEL_LAST_ROW,
  EXCEL_SHEET_DATA,
  EXCEL_SHEET_GUIDE,
  EXCEL_SHEET_LISTS,
} from './excel-columns';
import { buildExcelTemplate, type ProjectCatalog } from './excel-template';

export const catalog: ProjectCatalog = {
  project: { id: 'p1', key: 'DEMO', name: 'Dự án mẫu' },
  types: [
    { id: 't-epic', name: 'Epic', key: 'EPIC', hierarchyLevel: 1, isSubtask: false },
    { id: 't-task', name: 'Task', key: 'TASK', hierarchyLevel: 0, isSubtask: false },
    { id: 't-bug', name: 'Bug, nặng', key: 'BUG', hierarchyLevel: 0, isSubtask: false }, // có dấu phẩy: inline list sẽ vỡ
    { id: 't-sub', name: 'Sub-task', key: 'SUBTASK', hierarchyLevel: 0, isSubtask: true },
  ],
  priorities: [
    { id: 'pr-h', name: 'High' },
    { id: 'pr-l', name: 'Low' },
  ],
  statuses: [
    { id: 's-todo', name: 'To Do', isInitial: true },
    { id: 's-done', name: 'Done', isInitial: false },
  ],
  members: [
    { id: 'u1', displayName: 'Nguyễn An', email: 'an@x.com' },
    { id: 'u2', displayName: 'Nguyễn An', email: 'an2@x.com' }, // trùng tên
  ],
  sprints: [{ id: 'sp1', name: 'Sprint 1' }],
  epics: [{ id: 'e1', key: 'DEMO-EPIC-1', summary: 'Cổng thanh toán' }],
  labels: [{ id: 'l1', name: 'ui' }],
  components: [{ id: 'c1', name: 'Backend' }],
  versions: [{ id: 'v1', name: '1.0' }],
};

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

type DV = { type: string; formulae: unknown[]; errorStyle?: string; operator?: string };
const dvAt = (ws: ExcelJS.Worksheet, addr: string): DV | undefined =>
  (ws as unknown as { dataValidations: { model: Record<string, DV> } }).dataValidations.model[addr];

describe('buildExcelTemplate', () => {
  it('có 3 sheet; DanhSach là veryHidden; đủ 15 cột theo thứ tự, cột bắt buộc có *', async () => {
    const wb = await load(await buildExcelTemplate(catalog, new Date('2026-10-29T03:00:00Z')));
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      EXCEL_SHEET_DATA,
      EXCEL_SHEET_GUIDE,
      EXCEL_SHEET_LISTS,
    ]);
    expect(wb.getWorksheet(EXCEL_SHEET_LISTS)!.state).toBe('veryHidden');
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    const headers = EXCEL_COLUMNS.map((_, i) => String(ws.getCell(1, i + 1).value as string));
    expect(headers).toEqual([
      'Tiêu đề*',
      'Mô tả',
      'Loại việc*',
      'Ưu tiên',
      'Trạng thái',
      'Người phụ trách',
      'Người báo cáo',
      'Sprint',
      'Epic',
      'Nhãn',
      'Điểm',
      'Ngày bắt đầu',
      'Hạn hoàn thành',
      'Thành phần',
      'Phiên bản',
    ]);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getCell('A1').note).toBeTruthy();
  });

  it('drop-list tham chiếu range tuyệt đối vào DanhSach (không inline), áp dòng 2..1001', async () => {
    const wb = await load(await buildExcelTemplate(catalog));
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    const lists = wb.getWorksheet(EXCEL_SHEET_LISTS)!;

    // C = Loại việc → cột A của DanhSach, 3 giá trị (kể cả "Bug, nặng" có dấu phẩy).
    expect(dvAt(ws, 'C2')).toMatchObject({ type: 'list', formulae: ['DanhSach!$A$2:$A$4'] });
    expect(dvAt(ws, `C${EXCEL_LAST_ROW}`)).toMatchObject({ type: 'list' });
    expect(dvAt(ws, `C${EXCEL_LAST_ROW + 1}`)).toBeUndefined();
    expect(lists.getCell('A4').value).toBe('Bug, nặng');
    expect(dvAt(ws, 'D2')?.formulae).toEqual(['DanhSach!$B$2:$B$3']);
    expect(dvAt(ws, 'E2')?.formulae).toEqual(['DanhSach!$C$2:$C$3']);
    // Người phụ trách + người báo cáo dùng chung cột Thành viên (D) hiển thị Tên <email>.
    expect(dvAt(ws, 'F2')?.formulae).toEqual(['DanhSach!$D$2:$D$3']);
    expect(dvAt(ws, 'G2')?.formulae).toEqual(['DanhSach!$D$2:$D$3']);
    expect(lists.getCell('D2').value).toBe('Nguyễn An <an@x.com>');
    expect(lists.getCell('D3').value).toBe('Nguyễn An <an2@x.com>');
    expect(dvAt(ws, 'I2')?.formulae).toEqual(['DanhSach!$F$2:$F$2']);
    expect(lists.getCell('F2').value).toBe('DEMO-EPIC-1 — Cổng thanh toán');
    // Không có danh sách inline nào (chuỗi "a,b,c" bọc trong dấu nháy).
    for (const col of 'CDEFGHIJNO') {
      for (const f of dvAt(ws, `${col}2`)?.formulae ?? []) expect(String(f)).not.toMatch(/^"/);
    }
  });

  it('Nhãn/Thành phần: errorStyle information (không chặn); Điểm decimal 0–1000; ngày có validation date + numFmt', async () => {
    const wb = await load(await buildExcelTemplate(catalog));
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    expect(dvAt(ws, 'J2')).toMatchObject({ type: 'list', errorStyle: 'information' });
    expect(dvAt(ws, 'N2')).toMatchObject({ type: 'list', errorStyle: 'information' });
    expect(dvAt(ws, 'C2')?.errorStyle).toBe('stop');
    expect(dvAt(ws, 'K2')).toMatchObject({ type: 'decimal', formulae: [0, 1000] });
    expect(dvAt(ws, 'L2')?.type).toBe('date');
    expect(dvAt(ws, 'M2')?.type).toBe('date');
    expect(ws.getColumn(12).numFmt).toBe('dd/mm/yyyy');
    expect(ws.getColumn(13).numFmt).toBe('dd/mm/yyyy');
  });

  it('danh sách rỗng thì bỏ validation của cột đó', async () => {
    const wb = await load(
      await buildExcelTemplate({ ...catalog, sprints: [], versions: [], components: [] }),
    );
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    expect(dvAt(ws, 'H2')).toBeUndefined(); // Sprint
    expect(dvAt(ws, 'N2')).toBeUndefined(); // Thành phần
    expect(dvAt(ws, 'O2')).toBeUndefined(); // Phiên bản
    expect(dvAt(ws, 'C2')).toBeDefined();
  });

  it('sheet Hướng dẫn ghi tên dự án, mã, ngày tạo, ký tự ; và giới hạn', async () => {
    const wb = await load(await buildExcelTemplate(catalog, new Date('2026-10-29T03:00:00Z')));
    const g = wb.getWorksheet(EXCEL_SHEET_GUIDE)!;
    const text: string[] = [];
    g.eachRow((r) => r.eachCell((c) => text.push(c.text)));
    const all = text.join('\n');
    expect(all).toContain('Dự án mẫu (DEMO)');
    expect(all).toContain('29/10/2026 10:00');
    expect(all).toContain('dd/mm/yyyy');
    expect(all).toContain('";"');
    expect(all).toContain('1000');
  });

  it('Sub-task không có trong drop-list Loại việc (biểu mẫu không có cột Việc cha)', async () => {
    const wb = await load(await buildExcelTemplate(catalog));
    const lists = wb.getWorksheet(EXCEL_SHEET_LISTS)!;
    const col: string[] = [];
    lists.getColumn(1).eachCell((c, r) => {
      if (r > 1) col.push(c.text);
    });
    expect(col).toEqual(['Epic', 'Task', 'Bug, nặng']);
  });

  it('Người/Epic dùng errorStyle warning (cho gõ email/mã epic như hướng dẫn); Loại việc vẫn chặn', async () => {
    const wb = await load(await buildExcelTemplate(catalog));
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    for (const c of ['F2', 'G2', 'I2']) expect(dvAt(ws, c)?.errorStyle).toBe('warning');
    expect(dvAt(ws, 'C2')?.errorStyle).toBe('stop');
  });

  it('giá trị bắt đầu bằng = + - @ được ghi là CHUỖI (không thành công thức)', async () => {
    const evil = ['=HYPERLINK("http://x","y")', '+cmd', '-1+1', '@SUM(1)'];
    const wb = await load(
      await buildExcelTemplate({
        ...catalog,
        labels: evil.map((name, i) => ({ id: `e${i}`, name })),
      }),
    );
    const lists = wb.getWorksheet(EXCEL_SHEET_LISTS)!;
    evil.forEach((v, i) => {
      const cell = lists.getCell(i + 2, 7);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.value).toBe(v);
    });
  });
});
