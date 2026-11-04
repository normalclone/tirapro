import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertParityDatabase } from '../../common/testing/parity-db-guard';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from './search.service';

/**
 * DANH MỤC TRẠNG THÁI THEO QUY TRÌNH ĐANG DÙNG TRÊN POSTGRES THẬT — OPT-IN (`PARITY_DATABASE_URL=…_scratch`, xem
 * `test:parity`). Mock không chứng minh được hình dạng truy vấn Prisma của `statusWorkflowWhere` (scheme theo loại việc,
 * ghi đè của dự án, mặc định của dự án khi còn loại chưa cấu hình) — spec này chạy với dữ liệu thật.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const TAG = `sf${Date.now().toString(36)}`;
const id = (s: string): string => `${TAG}-${s}`;
const WS = id('ws');

describe.skipIf(!DB_URL)('SearchService.fields (trạng thái) ↔ Postgres thật', () => {
  let prisma: PrismaClient;
  let service: SearchService;

  const flow = async (key: string, names: string[]) => {
    await prisma.workflow.create({ data: { id: id(key), workspaceId: WS, name: key } });
    await prisma.status.createMany({
      data: names.map((n, i) => ({
        id: id(`${key}-${i}`),
        workflowId: id(key),
        name: n,
        category: (['TODO', 'IN_PROGRESS', 'DONE'] as const)[Math.min(i, 2)]!,
        order: i,
        isInitial: i === 0,
      })),
    });
  };
  const statusNames = async () =>
    (await service.fields(WS, id('u'))).statuses.map((s) => s.value).sort();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    const access = {
      visibleWhere: () => Promise.resolve({}),
      visibleProjectIds: () => Promise.resolve(null),
    };
    service = new SearchService({} as never, prisma as unknown as PrismaService, access as never);
    await prisma.user.create({
      data: { id: id('u'), email: `${id('u')}@sf.test`, displayName: 'QT' },
    });
    await prisma.workspace.create({ data: { id: WS, name: WS, slug: WS, ownerId: id('u') } });
    await flow('old', ['Cần làm', 'Đang làm', 'Xong']);
    await flow('std', ['To Do', 'In Review', 'Done']);
    await flow('bug', ['New', 'Ready for Retest', 'Done']);
    await flow('ovr', ['Chờ QA', 'Đang QA', 'Done']);
    await prisma.issueType.create({
      data: { id: id('t-task'), workspaceId: WS, name: 'Task', key: 'TASK' },
    });
    await prisma.issueType.create({
      data: { id: id('t-bug'), workspaceId: WS, name: 'Bug', key: 'BUG' },
    });
    await prisma.project.create({
      data: { id: id('p1'), workspaceId: WS, key: 'SFA', name: 'A', defaultWorkflowId: id('old') },
    });
    await prisma.project.create({
      data: { id: id('p2'), workspaceId: WS, key: 'SFB', name: 'B', defaultWorkflowId: id('old') },
    });
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
    await prisma.$disconnect();
  }, 60_000);

  it('chưa có cấu hình nào → như trước: mọi quy trình xem được', async () => {
    const names = await statusNames();
    expect(names).toEqual(expect.arrayContaining(['Cần làm', 'In Review', 'Ready for Retest']));
  });

  it('có cấu hình theo loại việc → hợp theo tên của các quy trình đang dùng; quy trình cũ không còn dùng thì biến mất', async () => {
    await prisma.workspaceWorkflowScheme.createMany({
      data: [
        { workspaceId: WS, issueTypeId: id('t-task'), workflowId: id('std') },
        { workspaceId: WS, issueTypeId: id('t-bug'), workflowId: id('bug') },
      ],
    });
    // Mọi loại việc đều đã có cấu hình → quy trình mặc định cũ của dự án không còn việc nào dùng.
    expect(await statusNames()).toEqual(
      ['Done', 'In Review', 'New', 'Ready for Retest', 'To Do'].sort(),
    );
    // "Done" của hai quy trình chỉ là MỘT mục (JQL khớp theo tên).
    const out = await service.fields(WS, id('u'));
    expect(out.statuses.filter((s) => s.value === 'Done')).toHaveLength(1);
    expect(await service.validate(WS, id('u'), 'status = "Ready for Retest"')).toEqual({
      valid: true,
    });
    expect((await service.validate(WS, id('u'), 'status = "Cần làm"')).valid).toBe(false);
  });

  it('ghi đè của dự án được tính', async () => {
    await prisma.projectWorkflowOverride.create({
      data: { projectId: id('p2'), issueTypeId: id('t-task'), workflowId: id('ovr') },
    });
    expect(await statusNames()).toEqual(expect.arrayContaining(['Chờ QA', 'Đang QA', 'In Review']));
  });

  it('thêm loại việc chưa có cấu hình → quy trình mặc định của dự án lại được dùng', async () => {
    await prisma.issueType.create({
      data: { id: id('t-epic'), workspaceId: WS, name: 'Epic', key: 'EPIC' },
    });
    expect(await statusNames()).toEqual(expect.arrayContaining(['Cần làm', 'Đang làm', 'Xong']));
  });
});
