import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../../common/testing/parity-db-guard';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import { ExcelImportService } from './excel-import.service';

/**
 * TEMPLATE → ĐIỀN → XEM TRƯỚC TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch pnpm --filter @tirapro/api test:parity`).
 * Mock không chứng minh được các truy vấn danh mục (lọc sprint chưa đóng, phiên bản chưa phát hành, epic theo loại,
 * thành viên dự án ACTIVE, cô lập workspace) — spec này chạy chúng với dữ liệu thật. Bước ghi (`commit`) đi qua
 * IssuesService nên được kiểm bằng round-trip HTTP, không ở đây.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `xl${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS = id('ws');
const OTHER_WS = id('ws2');
const PROJECT = id('p');

describe.skipIf(!DB_URL)('ExcelImportService ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  let service: ExcelImportService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    service = new ExcelImportService(prisma as unknown as PrismaService, {} as never);
    const user = (s: string, status: 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE') =>
      prisma.user.create({
        data: { id: id(s), email: `${id(s)}@xl.test`, displayName: `Người ${s}`, status },
      });
    await user('owner');
    await user('member');
    await user('gone', 'DEACTIVATED');
    await user('outsider');
    for (const w of [WS, OTHER_WS])
      await prisma.workspace.create({ data: { id: w, name: w, slug: w, ownerId: id('owner') } });
    const wf = await prisma.workflow.create({
      data: { id: id('wf'), workspaceId: WS, name: 'WF' },
    });
    await prisma.status.createMany({
      data: [
        {
          id: id('s1'),
          workflowId: wf.id,
          name: 'Mới',
          category: 'TODO',
          order: 0,
          isInitial: true,
        },
        { id: id('s2'), workflowId: wf.id, name: 'Xong', category: 'DONE', order: 1 },
      ],
    });
    await prisma.project.create({
      data: { id: PROJECT, workspaceId: WS, key: 'XL', name: 'Dự án XL', defaultWorkflowId: wf.id },
    });
    await prisma.issueType.createMany({
      data: [
        { id: id('t-epic'), workspaceId: WS, name: 'Epic', key: 'EPIC', hierarchyLevel: 1 },
        { id: id('t-task'), workspaceId: WS, name: 'Task', key: 'TASK' },
        { id: id('t-other'), workspaceId: OTHER_WS, name: 'Loại tenant khác' },
      ],
    });
    await prisma.priority.create({ data: { id: id('pr'), workspaceId: WS, name: 'Cao', rank: 5 } });
    const role = await prisma.role.create({
      data: { id: id('role'), workspaceId: WS, name: 'Dev', scope: 'PROJECT' },
    });
    await prisma.projectMembership.createMany({
      data: ['member', 'gone'].map((u) => ({ projectId: PROJECT, userId: id(u), roleId: role.id })),
    });
    await prisma.sprint.createMany({
      data: [
        { id: id('sp-f'), projectId: PROJECT, name: 'Sắp tới', state: 'FUTURE', sequence: 1 },
        { id: id('sp-a'), projectId: PROJECT, name: 'Đang chạy', state: 'ACTIVE', sequence: 2 },
        { id: id('sp-c'), projectId: PROJECT, name: 'Đã đóng', state: 'CLOSED', sequence: 3 },
      ],
    });
    await prisma.issue.createMany({
      data: [
        { id: id('i-epic'), key: 'XL-EPIC-1', typeId: id('t-epic'), summary: 'Cổng TT', number: 1 },
        {
          id: id('i-task'),
          key: 'XL-TASK-2',
          typeId: id('t-task'),
          summary: 'Một việc',
          number: 2,
        },
      ].map((i) => ({
        ...i,
        workspaceId: WS,
        projectId: PROJECT,
        statusId: id('s1'),
        rank: `0|${i.number}:`,
      })),
    });
    await prisma.label.create({ data: { id: id('l'), projectId: PROJECT, name: 'ui' } });
    await prisma.component.create({ data: { id: id('c'), projectId: PROJECT, name: 'Backend' } });
    await prisma.version.createMany({
      data: [
        { id: id('v1'), projectId: PROJECT, name: '1.0' },
        { id: id('v2'), projectId: PROJECT, name: '0.9', status: 'RELEASED' },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    // Dự án (kéo theo membership) phải đi trước Role (RESTRICT), rồi mới tới workspace.
    await prisma.project.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.$disconnect();
  }, 60_000);

  it('template: danh sách lấy đúng từ DB (chỉ việc thuộc dự án/tenant, sprint chưa đóng, phiên bản chưa phát hành, thành viên chưa bị khoá)', async () => {
    const { buffer, filename } = await service.template(WS, PROJECT);
    expect(filename).toBe('Mau-nhap-cong-viec-XL.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const lists = wb.getWorksheet('DanhSach')!;
    const col = (n: number): string[] => {
      const out: string[] = [];
      lists.getColumn(n).eachCell((c, r) => {
        if (r > 1 && c.text !== '') out.push(c.text);
      });
      return out;
    };
    expect(col(1)).toEqual(['Epic', 'Task']); // không có loại của tenant khác
    expect(col(2)).toEqual(['Cao']);
    expect(col(3)).toEqual(['Mới', 'Xong']);
    expect(col(4)).toEqual([`Người member <${id('member')}@xl.test>`]); // bỏ người đã khoá
    expect(col(5)).toEqual(['Sắp tới', 'Đang chạy']); // theo thứ tự sprint, bỏ sprint đã đóng
    expect(col(6)).toEqual(['XL-EPIC-1 — Cổng TT']); // chỉ epic, không phải Task
    expect(col(7)).toEqual(['ui']);
    expect(col(9)).toEqual(['1.0']); // bỏ phiên bản đã phát hành
  });

  it('template → điền → xem trước: dòng tốt hợp lệ, người ngoài dự án/phiên bản đã phát hành là lỗi', async () => {
    const { buffer } = await service.template(WS, PROJECT);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Công việc')!;
    const fill = (r: number, v: Record<string, string>) =>
      Object.entries(v).forEach(([c, x]) => (ws.getCell(`${c}${r}`).value = x));
    fill(2, {
      A: 'Tốt',
      C: 'Task',
      E: 'Xong',
      I: 'XL-EPIC-1',
      J: 'ui; mới',
      N: 'Backend',
      O: '1.0',
    });
    fill(3, { A: 'Người lạ', C: 'Task', F: `${id('outsider')}@xl.test` });
    fill(4, { A: 'Bản cũ', C: 'Task', O: '0.9' });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await service.preview(WS, PROJECT, {
      buffer: buf,
      size: buf.length,
      originalname: 'x.xlsx',
      mimetype: 'application/octet-stream',
    });
    expect(res).toMatchObject({ total: 3, valid: 1, invalid: 2 });
    expect(res.rows[0]!.warnings.map((w) => w.message)).toEqual(["Nhãn mới 'mới' sẽ được tạo"]);
    expect(res.rows[1]!.errors[0]!.column).toBe('Người phụ trách');
    expect(res.rows[2]!.errors[0]!.column).toBe('Phiên bản');
  });

  it('cô lập không gian làm việc: dự án của không gian khác → 404, không đọc được danh mục', async () => {
    await expect(service.template(OTHER_WS, PROJECT)).rejects.toThrow();
  });
});
