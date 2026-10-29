/* eslint-disable @typescript-eslint/no-unsafe-assignment, max-lines-per-function -- spec: matcher lồng nhau và bộ test dài */
import { deflateRawSync, crc32 } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { ImportService } from '../import.service';
import { EXCEL_SHEET_DATA } from './excel-columns';
import { ExcelImportService } from './excel-import.service';
import { parseExcelDate, parseExcelNumber } from './excel-parse';
import { buildExcelTemplate } from './excel-template';
import { catalog } from './excel-template.spec';

type Cells = Record<string, ExcelJS.CellValue>;
const H = {
  summary: 'Tiêu đề*',
  description: 'Mô tả',
  type: 'Loại việc*',
  priority: 'Ưu tiên',
  status: 'Trạng thái',
  assignee: 'Người phụ trách',
  reporter: 'Người báo cáo',
  sprint: 'Sprint',
  epic: 'Epic',
  labels: 'Nhãn',
  points: 'Điểm',
  start: 'Ngày bắt đầu',
  due: 'Hạn hoàn thành',
  components: 'Thành phần',
  version: 'Phiên bản',
};

/** Dựng .xlsx: `headers` (có thể đảo thứ tự), mỗi dòng là map tiêu đề → giá trị. */
async function xlsxOf(
  rows: Cells[],
  headers: string[] = Object.values(H),
  gapAfter?: number,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(EXCEL_SHEET_DATA);
  ws.addRow(headers);
  let r = 2;
  for (const [i, row] of rows.entries()) {
    if (gapAfter !== undefined && i === gapAfter) r += 2; // dòng trống ở giữa
    headers.forEach((h, c) => {
      const v = row[h];
      if (v !== undefined) ws.getCell(r, c + 1).value = v;
    });
    r++;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = (
  buffer: Buffer,
  over: Partial<{ mimetype: string; originalname: string }> = {},
) => ({
  buffer,
  size: buffer.length,
  mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  originalname: 'nhap.xlsx',
  ...over,
});

const good = (over: Cells = {}): Cells => ({
  [H.summary]: 'Việc A',
  [H.type]: 'Task',
  ...over,
});

function setup() {
  const tx = {
    issue: { update: vi.fn(() => Promise.resolve({})) },
    issueLabel: {
      createMany: vi.fn((_a: { data: unknown[] }) => Promise.resolve({})),
    },
    issueComponent: { createMany: vi.fn(() => Promise.resolve({})) },
    issueFixVersion: { createMany: vi.fn(() => Promise.resolve({})) },
    label: {
      upsert: vi.fn(({ create }: { create: { name: string } }) =>
        Promise.resolve({ id: `new-${create.name}` }),
      ),
    },
  };
  const c = catalog;
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    project: {
      findFirst: vi.fn(() =>
        Promise.resolve({ ...c.project, archivedAt: null, defaultWorkflowId: 'wf1' }),
      ),
    },
    importJob: {
      create: vi.fn(() => Promise.resolve({ id: 'job1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    issueType: { findMany: vi.fn(() => Promise.resolve(c.types)) },
    priority: { findMany: vi.fn(() => Promise.resolve(c.priorities)) },
    status: { findMany: vi.fn(() => Promise.resolve(c.statuses)) },
    projectMembership: {
      findMany: vi.fn(() => Promise.resolve(c.members.map((user) => ({ user })))),
    },
    sprint: { findMany: vi.fn(() => Promise.resolve(c.sprints)) },
    issue: { findMany: vi.fn(() => Promise.resolve(c.epics)) },
    label: { findMany: vi.fn(() => Promise.resolve(c.labels)) },
    component: { findMany: vi.fn(() => Promise.resolve(c.components)) },
    version: { findMany: vi.fn(() => Promise.resolve(c.versions)) },
  };
  const issues = {
    createWithin: vi.fn(
      async (
        _tx: unknown,
        _w: string,
        _u: string,
        input: { summary: string; startDate?: string },
        _deferred?: unknown,
        _fixedKey?: string,
        _overrides?: { reporterId?: string },
      ) => {
        await Promise.resolve();
        if (input.summary === 'LỖI DB') throw new Error('lỗi DB giả lập');
        return { id: `id-${input.summary}` };
      },
    ),
    emitCreated: vi.fn(),
  };
  const importer = new ImportService(prisma as never, issues as never);
  const service = new ExcelImportService(prisma as never, importer);
  return { service, prisma, issues, tx };
}

const preview = async (rows: Cells[], headers?: string[], gap?: number) => {
  const s = setup();
  const res = await s.service.preview('w1', 'p1', upload(await xlsxOf(rows, headers, gap)));
  return { ...s, res };
};

describe('parseExcelDate / parseExcelNumber', () => {
  it('Date, serial Excel và chuỗi cùng cho ra MỘT ngày lịch (không lệch múi giờ)', () => {
    const iso = '2026-03-15T00:00:00.000Z';
    expect(parseExcelDate(new Date(Date.UTC(2026, 2, 15)))).toBe(iso); // exceljs: UTC midnight
    expect(parseExcelDate(46096)).toBe(iso); // serial 15/03/2026
    expect(parseExcelDate('15/03/2026')).toBe(iso);
    expect(parseExcelDate('2026-03-15')).toBe(iso);
    expect(parseExcelDate('5/3/2026')).toBe('2026-03-05T00:00:00.000Z');
  });
  it('trống → undefined; sai → null (31/02, chữ, boolean)', () => {
    expect(parseExcelDate(null)).toBeUndefined();
    expect(parseExcelDate('  ')).toBeUndefined();
    expect(parseExcelDate('31/02/2026')).toBeNull();
    expect(parseExcelDate('mai')).toBeNull();
    expect(parseExcelDate(true)).toBeNull();
  });
  it('số: chấp nhận dấu phẩy thập phân', () => {
    expect(parseExcelNumber('2,5')).toBe(2.5);
    expect(parseExcelNumber(3)).toBe(3);
    expect(parseExcelNumber('abc')).toBeNull();
    expect(parseExcelNumber(null)).toBeUndefined();
  });
});

describe('ExcelImportService.preview', () => {
  it('dòng hợp lệ đầy đủ cột; số dòng = dòng Excel thật; bỏ qua dòng trống hoàn toàn', async () => {
    const { res } = await preview(
      [
        good({ [H.summary]: 'Một' }),
        good({
          [H.summary]: 'Hai',
          [H.priority]: 'high',
          [H.status]: 'Done',
          [H.assignee]: 'Nguyễn An <an@x.com>',
          [H.reporter]: 'an2@x.com',
          [H.sprint]: 'Sprint 1',
          [H.epic]: 'DEMO-EPIC-1 — Cổng thanh toán',
          [H.points]: 2.5,
          [H.components]: 'Backend',
          [H.version]: '1.0',
        }),
      ],
      undefined,
      1, // chèn 2 dòng trống trước dòng thứ hai
    );
    expect(res.total).toBe(2);
    expect(res.valid).toBe(2);
    expect(res.invalid).toBe(0);
    expect(res.rows.map((r) => r.row)).toEqual([2, 5]);
    expect(res.rows[1]!.summary).toBe('Hai');
  });

  it('header đảo thứ tự, không phân biệt hoa/thường, có/không dấu *, cột lạ bị bỏ qua', async () => {
    const headers = ['loại việc', 'TIÊU ĐỀ *', 'Cột lạ', 'Ưu tiên'];
    const { res } = await preview(
      [{ 'loại việc': 'Task', 'TIÊU ĐỀ *': 'Đảo cột', 'Cột lạ': 'x', 'Ưu tiên': 'Low' }],
      headers,
    );
    expect(res).toMatchObject({ total: 1, valid: 1, invalid: 0 });
    expect(res.rows[0]!.summary).toBe('Đảo cột');
  });

  it('thiếu cột bắt buộc → lỗi cả tệp', async () => {
    const s = setup();
    const buf = await xlsxOf([{ 'Mô tả': 'x' }], ['Mô tả', 'Ưu tiên']);
    await expect(s.service.preview('w1', 'p1', upload(buf))).rejects.toThrow(
      'Thiếu cột bắt buộc: Tiêu đề, Loại việc',
    );
  });

  it('rich text / hyperlink / công thức lấy text', async () => {
    const { res } = await preview([
      {
        [H.summary]: { richText: [{ text: 'Rich ' }, { text: 'text' }] },
        [H.type]: { text: 'Task', hyperlink: 'https://x.vn' },
        [H.priority]: { formula: '"Hi"&"gh"', result: 'High' },
      },
    ]);
    expect(res).toMatchObject({ valid: 1, invalid: 0 });
    expect(res.rows[0]!.summary).toBe('Rich text');
  });

  it('ngày dạng Date / serial / chuỗi → hợp lệ, hạn < bắt đầu → lỗi ở cột Hạn hoàn thành', async () => {
    const { res } = await preview([
      good({ [H.start]: new Date(Date.UTC(2026, 2, 15)), [H.due]: 46100 }), // 19/03
      good({ [H.start]: '20/03/2026', [H.due]: '2026-03-19' }),
      good({ [H.start]: '31/02/2026' }),
    ]);
    expect(res.rows[0]!.errors).toEqual([]);
    expect(res.rows[1]!.errors).toEqual([
      { column: 'Hạn hoàn thành', message: 'Hạn hoàn thành phải sau hoặc bằng Ngày bắt đầu' },
    ]);
    expect(res.rows[2]!.errors[0]).toMatchObject({ column: 'Ngày bắt đầu' });
    expect(res.rows[2]!.errors[0]!.message).toContain("'31/02/2026' không phải ngày hợp lệ");
  });

  it('người ngoài dự án, loại sai, thiếu tiêu đề, điểm ngoài khoảng, thành phần/phiên bản lạ → lỗi đúng cột', async () => {
    const { res } = await preview([
      good({ [H.assignee]: 'abc@x.com' }),
      good({ [H.type]: 'Không có' }),
      good({ [H.summary]: '', [H.description]: 'chỉ có mô tả' }),
      good({ [H.points]: 1001 }),
      good({ [H.components]: 'Backend; Lạ' }),
      good({ [H.version]: '0.9' }),
      good({ [H.sprint]: 'Sprint cũ' }),
      good({ [H.summary]: 'x'.repeat(256) }),
    ]);
    const col = (i: number) => res.rows[i]!.errors.map((e) => e.column);
    expect(res.rows[0]!.errors[0]).toEqual({
      column: 'Người phụ trách',
      message: "'abc@x.com' không phải thành viên dự án",
    });
    expect(col(1)).toEqual(['Loại việc']);
    expect(col(2)).toEqual(['Tiêu đề']);
    expect(col(3)).toEqual(['Điểm']);
    expect(col(4)).toEqual(['Thành phần']);
    expect(col(5)).toEqual(['Phiên bản']);
    expect(col(6)).toEqual(['Sprint']);
    expect(col(7)).toEqual(['Tiêu đề']);
    expect(res.invalid).toBe(8);
  });

  it('nhãn mới → cảnh báo (không lỗi); nhãn có sẵn không cảnh báo', async () => {
    const { res } = await preview([good({ [H.labels]: 'ui; mới; UI; Mới2' })]);
    expect(res.rows[0]!.errors).toEqual([]);
    expect(res.rows[0]!.warnings.map((w) => w.message)).toEqual([
      "Nhãn mới 'mới' sẽ được tạo",
      "Nhãn mới 'Mới2' sẽ được tạo",
    ]);
  });

  it('epic: nhận "KEY — tiêu đề" hoặc chỉ mã; Epic không nằm trong epic khác', async () => {
    const { res } = await preview([
      good({ [H.epic]: 'DEMO-EPIC-1' }),
      good({ [H.type]: 'Epic', [H.epic]: 'DEMO-EPIC-1 — Cổng thanh toán' }),
      good({ [H.epic]: 'DEMO-EPIC-9' }),
    ]);
    expect(res.rows[0]!.errors).toEqual([]);
    expect(res.rows[1]!.errors[0]!.message).toContain('cấp cao nhất');
    expect(res.rows[2]!.errors[0]!.column).toBe('Epic');
  });

  it('tên người trùng nhau: phân biệt theo email; "Tên <email>" và chỉ email đều được', async () => {
    const { res } = await preview([
      good({ [H.assignee]: 'Nguyễn An <an2@x.com>' }),
      good({ [H.assignee]: 'AN@X.COM' }),
    ]);
    expect(res.invalid).toBe(0);
  });

  it('sprint trùng tên → lỗi, không chọn bừa', async () => {
    const s = setup();
    s.prisma.sprint.findMany.mockResolvedValue([
      { id: 'a', name: 'S' },
      { id: 'b', name: 'S' },
    ]);
    const res = await s.service.preview(
      'w1',
      'p1',
      upload(await xlsxOf([good({ [H.sprint]: 'S' })])),
    );
    expect(res.rows[0]!.errors[0]!.message).toContain('2 sprint trùng tên');
  });

  it('>1000 dòng dữ liệu bị từ chối', async () => {
    const s = setup();
    const rows = Array.from({ length: 1001 }, (_, i) => good({ [H.summary]: `v${i}` }));
    await expect(s.service.preview('w1', 'p1', upload(await xlsxOf(rows)))).rejects.toThrow(
      'vượt giới hạn 1000 dòng',
    );
  });

  it('không phải xlsx: đuôi/mimetype/magic bytes sai → từ chối', async () => {
    const s = setup();
    const xlsx = await xlsxOf([good()]);
    await expect(
      s.service.preview('w1', 'p1', upload(Buffer.from('a,b\n1,2\n'), { originalname: 'a.xlsx' })),
    ).rejects.toThrow('Chỉ nhận tệp .xlsx');
    await expect(
      s.service.preview('w1', 'p1', upload(xlsx, { originalname: 'a.csv' })),
    ).rejects.toThrow('Chỉ nhận tệp .xlsx');
    await expect(
      s.service.preview('w1', 'p1', upload(xlsx, { mimetype: 'text/csv' })),
    ).rejects.toThrow('Chỉ nhận tệp .xlsx');
    // magic đúng (PK) nhưng nội dung không phải xlsx
    await expect(
      s.service.preview(
        'w1',
        'p1',
        upload(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(30)])),
      ),
    ).rejects.toThrow('Không đọc được tệp Excel');
    await expect(s.service.preview('w1', 'p1', undefined)).rejects.toThrow('Thiếu tệp Excel');
  });

  it('không ghi DB; dự án khác workspace → 404; dự án lưu trữ → chặn', async () => {
    const s = setup();
    s.prisma.project.findFirst.mockResolvedValueOnce(null as never);
    await expect(s.service.preview('w1', 'p1', upload(await xlsxOf([good()])))).rejects.toThrow();
    expect(s.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', workspaceId: 'w1', deletedAt: null } }),
    );
    s.prisma.project.findFirst.mockResolvedValueOnce({ id: 'p1', archivedAt: new Date() } as never);
    await expect(s.service.preview('w1', 'p1', upload(await xlsxOf([good()])))).rejects.toThrow();
    expect(s.prisma.importJob.create).not.toHaveBeenCalled();
    expect(s.issues.createWithin).not.toHaveBeenCalled();
  });
});

describe('ExcelImportService.commit', () => {
  it('bỏ dòng lỗi, nhập dòng tốt; nhãn mới được tạo; thành phần/phiên bản/người báo cáo gắn đúng; job source EXCEL', async () => {
    const s = setup();
    const buf = await xlsxOf([
      good({
        [H.summary]: 'Tốt',
        [H.labels]: 'ui; mới',
        [H.components]: 'Backend',
        [H.version]: '1.0',
        [H.reporter]: 'an2@x.com',
        [H.priority]: 'High',
        [H.status]: 'Done',
        [H.assignee]: 'an@x.com',
        [H.sprint]: 'Sprint 1',
        [H.epic]: 'DEMO-EPIC-1',
        [H.points]: 3,
        [H.start]: '01/03/2026',
        [H.due]: '15/03/2026',
      }),
      good({ [H.summary]: 'Xấu', [H.assignee]: 'abc@x.com' }),
      good({ [H.summary]: 'LỖI DB' }),
    ]);
    const r = await s.service.commit('w1', 'u9', 'p1', upload(buf));

    expect(r).toMatchObject({ source: 'EXCEL', created: 1, failed: 2, total: 3, jobId: 'job1' });
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(r.errors[0]!.error).toBe(
      "Dòng 3 · Người phụ trách: 'abc@x.com' không phải thành viên dự án",
    );

    // Job
    expect(s.prisma.importJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'EXCEL', createdById: 'u9', workspaceId: 'w1' }),
      }),
    );
    expect(s.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', processedItems: 1 }),
      }),
    );

    // Input gửi vào createWithin của dòng tốt
    const tốt = s.issues.createWithin.mock.calls.find((c) => c[3].summary === 'Tốt')!;
    expect(tốt[3]).toMatchObject({
      projectId: 'p1',
      typeId: 't-task',
      priorityId: 'pr-h',
      statusId: 's-done',
      assigneeId: 'u1',
      sprintId: 'sp1',
      epicId: 'e1',
      storyPoints: 3,
      startDate: '2026-03-01T00:00:00.000Z',
      dueDate: '2026-03-15T00:00:00.000Z',
    });
    // Nhãn mới tạo (chỉ 'mới'; 'ui' có sẵn dùng cache), liên kết 2 nhãn
    // (lô có dòng lỗi DB nên chạy lại từng dòng → upsert có thể gọi lặp, nhưng chỉ cho nhãn 'mới')
    expect(s.tx.label.upsert.mock.calls.length).toBeGreaterThan(0);
    for (const [arg] of s.tx.label.upsert.mock.calls)
      expect(arg.create).toEqual({ projectId: 'p1', name: 'mới' });
    expect(s.tx.issueLabel.createMany).toHaveBeenCalledWith({
      data: [
        { issueId: 'id-Tốt', labelId: 'l1' },
        { issueId: 'id-Tốt', labelId: 'new-mới' },
      ],
      skipDuplicates: true,
    });
    expect(s.tx.issueComponent.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'id-Tốt', componentId: 'c1' }],
      skipDuplicates: true,
    });
    expect(s.tx.issueFixVersion.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'id-Tốt', versionId: 'v1', type: 'FIX' }],
      skipDuplicates: true,
    });
    // Người báo cáo đặt NGAY trong create (tham số nội bộ thứ 7), không update sau → sự kiện mang đúng reporter.
    expect(tốt[6]).toEqual({ reporterId: 'u2' });
    expect(s.tx.issue.update).not.toHaveBeenCalled();
  });

  it('validate lại từ đầu: tệp toàn dòng lỗi → không tạo gì, job FAILED, không gọi createWithin', async () => {
    const s = setup();
    const r = await s.service.commit(
      'w1',
      'u9',
      'p1',
      upload(await xlsxOf([good({ [H.type]: 'Sai' })])),
    );
    expect(r).toMatchObject({ created: 0, failed: 1, total: 1 });
    expect(s.issues.createWithin).not.toHaveBeenCalled();
    expect(s.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('không có người báo cáo thì không update reporter (giữ người nhập)', async () => {
    const s = setup();
    await s.service.commit('w1', 'u9', 'p1', upload(await xlsxOf([good()])));
    expect(s.tx.issue.update).not.toHaveBeenCalled();
    expect(s.tx.issueFixVersion.createMany).not.toHaveBeenCalled();
  });
});

/** Zip tối giản 1 entry (deflate) để dựng tệp "bom": 60 MB số 0 nén còn vài chục KB. */
function zipOf(name: string, data: Buffer): Buffer {
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(n.length, 28);
  const cdOff = lh.length + n.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length + n.length, 12);
  end.writeUInt32LE(cdOff, 16);
  return Buffer.concat([lh, n, comp, cd, n, end]);
}

describe('chặn tệp xlsx độc hại TRƯỚC khi exceljs nạp vào RAM', () => {
  it('zip bomb (1 entry 60 MB số 0, nén cao) bị từ chối bằng thông báo tiếng Việt', async () => {
    const s = setup();
    const bomb = zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(60 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    await expect(s.service.preview('w1', 'p1', upload(bomb))).rejects.toThrow(
      'Tệp Excel giải nén quá lớn',
    );
    expect(s.prisma.importJob.create).not.toHaveBeenCalled();
  });
  it('entry có đường dẫn lạ / chứa .. bị từ chối', async () => {
    const s = setup();
    for (const name of ['evil.sh', 'xl/../../etc/passwd'])
      await expect(
        s.service.preview('w1', 'p1', upload(zipOf(name, Buffer.from('x')))),
      ).rejects.toThrow('Tệp Excel giải nén quá lớn');
  });
  it('sheet khai báo tới dòng quá lớn bị dừng trước khi duyệt', async () => {
    const s = setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(EXCEL_SHEET_DATA);
    ws.addRow(Object.values(H));
    ws.getCell(20_000, 1).value = 'x';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(s.service.preview('w1', 'p1', upload(buf))).rejects.toThrow(
      'Sheet khai báo tới dòng 20000',
    );
  });
  it('tệp hợp lệ bình thường vẫn qua', async () => {
    const { res } = await preview([good()]);
    expect(res.valid).toBe(1);
  });
});

describe('ngày không lệch theo múi giờ máy chủ', () => {
  it.each(['America/Los_Angeles', 'Asia/Ho_Chi_Minh', 'UTC', 'Pacific/Kiritimati'])(
    'TZ=%s: ô ngày (Date), serial và chuỗi cùng ra 15/03/2026',
    async (tz) => {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try {
        const { res, prisma } = await preview([
          good({ [H.start]: new Date(Date.UTC(2026, 2, 15)) }),
          good({ [H.start]: 46096 }),
          good({ [H.start]: '15/03/2026' }),
        ]);
        expect(res.invalid).toBe(0);
        // đọc lại bằng exceljs thật: ô ngày trong tệp thực → cùng ngày lịch
        expect(prisma.project.findFirst).toHaveBeenCalled();
        const s = setup();
        const r = await s.service.commit(
          'w1',
          'u9',
          'p1',
          upload(
            await xlsxOf([
              good({ [H.start]: new Date(Date.UTC(2026, 2, 15)) }),
              good({ [H.start]: 46096 }),
              good({ [H.start]: '15/03/2026' }),
            ]),
          ),
        );
        expect(r.created).toBe(3);
        expect(s.issues.createWithin.mock.calls.map((c) => c[3].startDate)).toEqual([
          '2026-03-15T00:00:00.000Z',
          '2026-03-15T00:00:00.000Z',
          '2026-03-15T00:00:00.000Z',
        ]);
      } finally {
        if (prev === undefined) delete process.env.TZ;
        else process.env.TZ = prev;
      }
    },
  );
});

describe('ExcelImportService — nhãn, danh mục, sub-task', () => {
  it('hai dòng cùng nhãn mới trong một lô → chỉ 1 upsert; "UI" khớp nhãn có sẵn "ui" (không tạo)', async () => {
    const s = setup();
    const r = await s.service.commit(
      'w1',
      'u9',
      'p1',
      upload(
        await xlsxOf([
          good({ [H.summary]: 'A', [H.labels]: 'mới; UI' }),
          good({ [H.summary]: 'B', [H.labels]: 'MỚI' }),
        ]),
      ),
    );
    expect(r.created).toBe(2);
    expect(s.tx.label.upsert).toHaveBeenCalledTimes(1);
    const links = s.tx.issueLabel.createMany.mock.calls.map((c) => c[0].data);
    expect(links[0]).toEqual([
      { issueId: 'id-A', labelId: 'new-mới' },
      { issueId: 'id-A', labelId: 'l1' },
    ]);
    expect(links[1]).toEqual([{ issueId: 'id-B', labelId: 'new-mới' }]);
  });

  it('loại Sub-task gõ tay → lỗi dòng tiếng Việt, không nhập', async () => {
    const s = setup();
    s.prisma.issueType.findMany.mockResolvedValue([...catalog.types] as never);
    const res = await s.service.preview(
      'w1',
      'p1',
      upload(await xlsxOf([good({ [H.type]: 'Sub-task' })])),
    );
    expect(res.rows[0]!.errors).toEqual([
      {
        column: 'Loại việc',
        message: "'Sub-task' cần việc cha nên không nhập được từ biểu mẫu — hãy chọn loại khác",
      },
    ]);
  });

  it('mọi truy vấn danh mục đều ràng workspaceId/projectId', async () => {
    const s = setup();
    await s.service.preview('w1', 'p1', upload(await xlsxOf([good()])));
    const where = (m: { mock: { calls: unknown[][] } }) =>
      JSON.stringify((m.mock.calls[0]![0] as { where: unknown }).where);
    expect(where(s.prisma.issueType.findMany)).toContain('"workspaceId":"w1"');
    expect(where(s.prisma.priority.findMany)).toContain('"workspaceId":"w1"');
    expect(where(s.prisma.status.findMany)).toContain('"workflowId":"wf1"');
    for (const m of [
      s.prisma.projectMembership.findMany,
      s.prisma.sprint.findMany,
      s.prisma.label.findMany,
      s.prisma.component.findMany,
      s.prisma.version.findMany,
    ])
      expect(where(m)).toContain('"projectId":"p1"');
    expect(where(s.prisma.issue.findMany)).toContain('"projectId":"p1"');
    expect(where(s.prisma.issue.findMany)).toContain('"workspaceId":"w1"');
  });
});

describe('ExcelImportService.template', () => {
  it('trả buffer .xlsx + tên Mau-nhap-cong-viec-KEY.xlsx; đọc lại được', async () => {
    const s = setup();
    const t = await s.service.template('w1', 'p1');
    expect(t.filename).toBe('Mau-nhap-cong-viec-DEMO.xlsx');
    expect(t.buffer.subarray(0, 2).toString()).toBe('PK');
    // template tải về rồi điền → preview round-trip
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(EXCEL_SHEET_DATA)!;
    ws.getCell('A2').value = 'Điền từ mẫu';
    ws.getCell('C2').value = 'Bug, nặng';
    ws.getCell('F2').value = 'Nguyễn An <an@x.com>';
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await s.service.preview('w1', 'p1', upload(filled));
    expect(res).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });

  it('buildExcelTemplate dùng được độc lập', async () => {
    expect((await buildExcelTemplate(catalog)).length).toBeGreaterThan(1000);
  });
});
