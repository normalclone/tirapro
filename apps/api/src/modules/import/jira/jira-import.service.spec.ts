import { mkdtempSync, existsSync, readFileSync, utimesSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraImportRunInput } from '@tirapro/shared';
import {
  BusinessRuleException,
  NotFoundAppException,
} from '../../../common/exceptions/app.exception';
import type { PreparedItem } from '../import.service';
import { JiraImportService } from './jira-import.service';

const CSV = readFileSync(join(__dirname, '..', 'fixtures', 'jira-sample.csv'));
const tmpRoot = mkdtempSync(join(tmpdir(), 'jira-import-spec-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function setup(opts: { failSummaries?: string[] } = {}) {
  const localDir = mkdtempSync(join(tmpRoot, 'storage-'));
  const created: PreparedItem[] = [];
  const phases: PreparedItem[][] = [];

  const prisma = {
    importJob: {
      create: vi.fn(() => Promise.resolve({ id: 'job1' })),
      update: vi.fn(() => Promise.resolve({})),
    },
    project: {
      findFirst: vi.fn((args: { where: { id?: string; key?: string } }) =>
        Promise.resolve(
          args.where.key ? null : { id: 'p1', key: 'PROJ', defaultWorkflowId: 'wf1' },
        ),
      ),
      findUnique: vi.fn(() => Promise.resolve({ defaultWorkflowId: 'wf2' })),
    },
    issueType: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 't-epic', name: 'Epic', key: 'EPIC', isSubtask: false },
          { id: 't-story', name: 'Story', key: 'STORY', isSubtask: false },
          { id: 't-task', name: 'Task', key: 'TASK', isSubtask: false },
          { id: 't-bug', name: 'Bug', key: 'BUG', isSubtask: false },
          { id: 't-sub', name: 'Subtask', key: 'SUBTASK', isSubtask: true },
        ]),
      ),
      create: vi.fn(),
    },
    priority: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'pr-hi', name: 'High' },
          { id: 'pr-med', name: 'Medium' },
        ]),
      ),
      create: vi.fn((a: { data: { name: string } }) =>
        Promise.resolve({ id: `pr-new-${a.data.name}` }),
      ),
    },
    resolution: { findMany: vi.fn(() => Promise.resolve([{ id: 'res-done', name: 'Done' }])) },
    workspaceMembership: {
      findMany: vi.fn(() => Promise.resolve([{ userId: 'u-an' }, { userId: 'u-binh' }])),
    },
    status: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 's-todo', name: 'To Do', category: 'TODO' },
          { id: 's-prog', name: 'In Progress', category: 'IN_PROGRESS' },
          { id: 's-done', name: 'Done', category: 'DONE' },
        ]),
      ),
      aggregate: vi.fn(() => Promise.resolve({ _max: { order: 2 } })),
      create: vi.fn((a: { data: { name: string } }) =>
        Promise.resolve({ id: `s-new-${a.data.name}` }),
      ),
    },
    workflowTransition: { create: vi.fn(() => Promise.resolve({})) },
    board: { findMany: vi.fn(() => Promise.resolve([])) },
    boardColumn: { findFirst: vi.fn(), create: vi.fn() },
    boardColumnStatus: { upsert: vi.fn() },
    sprint: {
      findMany: vi.fn(() => Promise.resolve([])),
      findFirst: vi.fn(() => Promise.resolve({ sequence: 4 })),
      create: vi.fn((a: { data: { name: string } }) =>
        Promise.resolve({ id: `sp-${a.data.name}` }),
      ),
    },
    label: { findMany: vi.fn(() => Promise.resolve([])) },
    issue: { update: vi.fn(() => Promise.resolve({})) },
    issueLabel: { createMany: vi.fn(() => Promise.resolve({})) },
    comment: { createMany: vi.fn(() => Promise.resolve({})) },
  };
  const importService = {
    createIssuesInChunks: vi.fn(
      async (
        _w: string,
        _u: string,
        items: PreparedItem[],
        _cache: Map<string, string>,
        hooks?: { onChunk?: (n: number) => Promise<void> | void },
      ) => {
        await Promise.resolve();
        phases.push(items);
        const errors: Array<{ row: number; error: string }> = [];
        let ok = 0;
        for (const it of items) {
          if (opts.failSummaries?.includes(it.input.summary)) {
            errors.push({ row: it.row, error: 'lỗi DB giả lập' });
            continue;
          }
          created.push(it);
          it.onCreated?.({ id: `id-${it.input.summary}` } as unknown as Parameters<
            NonNullable<PreparedItem['onCreated']>
          >[0]);
          ok++;
        }
        await hooks?.onChunk?.(items.length);
        return { created: ok, labels: 0, comments: 0, errors };
      },
    ),
    resolveOrCreateLabel: vi.fn((_tx: unknown, _p: string, name: string) =>
      Promise.resolve(`lb-${name}`),
    ),
  };
  const projects = { create: vi.fn(() => Promise.resolve({ id: 'p-new', key: 'NEW' })) };
  const config = { get: vi.fn(() => localDir) };
  const service = new JiraImportService(
    prisma as never,
    importService as never,
    projects as never,
    config as never,
  );
  return { service, prisma, importService, projects, localDir, created, phases };
}

const file = (buf: Buffer = CSV) =>
  ({
    buffer: buf,
    size: buf.length,
    originalname: 'jira.csv',
    mimetype: 'text/csv',
  }) as Express.Multer.File;

const fullMapping = (): JiraImportRunInput['mapping'] => ({
  issueTypes: {
    Epic: 't-epic',
    Story: 't-story',
    Task: 't-task',
    Bug: 't-bug',
    'Sub-task': 't-sub',
  },
  statuses: { Done: 's-done', 'In Progress': 's-prog', 'In Review': 's-prog', 'To Do': 's-todo' },
  priorities: {
    High: 'pr-hi',
    Medium: 'pr-med',
    Highest: 'pr-hi',
    Low: '__create__',
    Lowest: '__create__',
  },
  users: { 'Nguyễn Văn An': 'u-an', 'Trần Thị Bình': 'u-binh', 'Lê Minh Cường': null },
});

const runInput = (
  analyzeId: string,
  patch: Partial<JiraImportRunInput> = {},
): JiraImportRunInput => ({
  analyzeId,
  projectId: 'p1',
  mapping: fullMapping(),
  options: { importComments: true, importSprints: true, keepJiraKey: true, dryRun: false },
  ...patch,
});

describe('JiraImportService.analyze', () => {
  it('lưu tệp dưới imports/<analyzeId>.csv và trả tóm tắt', async () => {
    const { service, localDir } = setup();
    const res = await service.analyze('w1', 'u1', file());
    expect(res.rows).toBe(20);
    expect(res.projectKeys).toEqual(['PROJ']);
    expect(existsSync(join(localDir, 'imports', `${res.analyzeId}.csv`))).toBe(true);
  });

  it('xoá tệp phân tích quá 1 giờ ở lần analyze kế tiếp', async () => {
    const { service, localDir } = setup();
    const old = await service.analyze('w1', 'u1', file());
    const past = new Date(Date.now() - 61 * 60 * 1000);
    for (const f of readdirSync(join(localDir, 'imports')))
      utimesSync(join(localDir, 'imports', f), past, past);
    const fresh = await service.analyze('w1', 'u1', file());
    expect(existsSync(join(localDir, 'imports', `${old.analyzeId}.csv`))).toBe(false);
    expect(existsSync(join(localDir, 'imports', `${fresh.analyzeId}.csv`))).toBe(true);
  });

  it('tệp không phải CSV Jira → lỗi nghiệp vụ, không để lại tệp', async () => {
    const { service, localDir } = setup();
    await expect(service.analyze('w1', 'u1', file(Buffer.from('a,b\n1,2\n')))).rejects.toThrow(
      /Summary/,
    );
    expect(
      existsSync(join(localDir, 'imports')) ? readdirSync(join(localDir, 'imports')) : [],
    ).toEqual([]);
  });
});

describe('JiraImportService.targets', () => {
  it('trả project/loại/ưu tiên/thành viên và trạng thái của project được chọn', async () => {
    const { service, prisma } = setup();
    Object.assign(prisma.project, {
      findMany: vi.fn(() => Promise.resolve([{ id: 'p1', key: 'PROJ', name: 'Dự án' }])),
    });
    Object.assign(prisma.workspaceMembership, {
      findMany: vi.fn(() =>
        Promise.resolve([
          { user: { id: 'u2', displayName: 'Bình', email: 'b@x.vn' } },
          { user: { id: 'u1', displayName: 'An', email: 'a@x.vn' } },
        ]),
      ),
    });
    const res = await service.targets('w1', 'p1');
    expect(res.projects).toEqual([{ id: 'p1', key: 'PROJ', name: 'Dự án' }]);
    expect(res.members.map((m) => m.displayName)).toEqual(['An', 'Bình']);
    expect(res.statuses.map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Done']);
    await expect(service.targets('w1', 'khác')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('JiraImportService.run — kiểm tra mapping', () => {
  it('thiếu mapping trạng thái → lỗi liệt kê đủ giá trị thiếu, chưa tạo ImportJob', async () => {
    const { service, prisma } = setup();
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    const mapping = fullMapping();
    delete mapping.statuses['In Review'];
    delete mapping.statuses['To Do'];
    delete mapping.priorities['Low'];
    const err = await service
      .run('w1', 'u1', runInput(analyzeId, { mapping }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleException);
    const msg = (err as Error).message;
    expect(msg).toContain('trạng thái: In Review, To Do');
    expect(msg).toContain('mức ưu tiên: Low');
    expect(prisma.importJob.create).not.toHaveBeenCalled();
  });

  it('id đích không thuộc workspace/workflow → lỗi', async () => {
    const { service } = setup();
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    const mapping = fullMapping();
    mapping.statuses['Done'] = 's-nơi-khác';
    mapping.users['Trần Thị Bình'] = 'u-ngoài-workspace';
    await expect(service.run('w1', 'u1', runInput(analyzeId, { mapping }))).rejects.toThrow(
      /s-nơi-khác|Done/,
    );
  });

  it('analyzeId của workspace khác → coi như không tồn tại', async () => {
    const { service } = setup();
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    await expect(service.run('w2', 'u2', runInput(analyzeId))).rejects.toThrow(/hết hạn|tải lại/);
  });

  it('project đích không thuộc workspace → NotFound', async () => {
    const { service, prisma } = setup();
    prisma.project.findFirst.mockResolvedValueOnce(null);
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    await expect(service.run('w1', 'u1', runInput(analyzeId))).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('dry-run: trả số liệu, KHÔNG ghi DB (không job, không project/sprint/type/priority, không issue)', async () => {
    const { service, prisma, importService, projects } = setup();
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    const res = await service.run(
      'w1',
      'u1',
      runInput(analyzeId, {
        newProject: { key: 'NEW', name: 'Dự án mới' },
        projectId: undefined,
        mapping: {
          ...fullMapping(),
          statuses: {
            Done: '__create__',
            'In Progress': '__create__',
            'In Review': '__create__',
            'To Do': '__create__',
          },
        },
        options: { importComments: true, importSprints: true, keepJiraKey: false, dryRun: true },
      }),
    );
    expect(res).toMatchObject({ dryRun: true, total: 20, epics: 2, subtasks: 6, sprints: 3 });
    expect(prisma.importJob.create).not.toHaveBeenCalled();
    expect(projects.create).not.toHaveBeenCalled();
    expect(prisma.sprint.create).not.toHaveBeenCalled();
    expect(prisma.priority.create).not.toHaveBeenCalled();
    expect(prisma.status.create).not.toHaveBeenCalled();
    expect(importService.createIssuesInChunks).not.toHaveBeenCalled();
  });
});

describe('JiraImportService.run — chạy thật', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  async function runAndWait(patch: Partial<JiraImportRunInput> = {}, c = ctx) {
    const { analyzeId } = await c.service.analyze('w1', 'u1', file());
    const res = await c.service.run('w1', 'u1', runInput(analyzeId, patch));
    expect(res).toEqual({ jobId: 'job1' });
    await c.service.waitForJob('job1');
    return analyzeId;
  }

  const lastUpdate = (c = ctx) => {
    const calls = c.prisma.importJob.update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    return calls[calls.length - 1]![0].data;
  };

  it('tạo theo tầng: epic trước, việc thường, rồi subtask; cha/epic resolve qua jiraKey → id', async () => {
    await runAndWait();
    expect(ctx.phases).toHaveLength(3);
    const summaries = (i: number) => ctx.phases[i]!.map((p) => p.input.summary);
    expect(summaries(0).slice(0, 2)).toEqual(['Nền tảng thanh toán', 'Báo cáo & thống kê']);
    expect(ctx.phases[2]!.every((p) => p.input.typeId === 't-sub')).toBe(true);
    expect(ctx.phases[2]).toHaveLength(6);

    const find = (s: string) => ctx.created.find((p) => p.input.summary === s)!;
    // Story → epic qua Custom field (Epic Link) = PROJ-1
    expect(find('Tích hợp cổng VNPay').input.epicId).toBe('id-Nền tảng thanh toán');
    // Subtask → Parent = id số 10003
    expect(find('Gọi API VNPay: tạo chữ ký').input.parentId).toBe('id-Tích hợp cổng VNPay');
    expect(find('Gọi API VNPay: tạo chữ ký').input.epicId).toBeUndefined();
  });

  it('map loại/trạng thái/ưu tiên/người dùng; tạo mới ưu tiên Low/Lowest; để trống user null', async () => {
    await runAndWait();
    const find = (s: string) => ctx.created.find((p) => p.input.summary === s)!;
    const story = find('Tích hợp cổng VNPay');
    expect(story.input).toMatchObject({
      typeId: 't-story',
      statusId: 's-done',
      priorityId: 'pr-hi',
      assigneeId: 'u-an',
      storyPoints: 8,
    });
    expect(story.input.description).toMatch(/^Nhập từ Jira: PROJ-3\n\nTích hợp VNPay\./);
    expect(find('Tài liệu hướng dẫn triển khai').input.priorityId).toBe('pr-new-Lowest');
    expect(find('Cấu hình CI/CD').input.assigneeId).toBeUndefined(); // Lê Minh Cường → để trống
    expect(ctx.prisma.priority.create).toHaveBeenCalledTimes(2);
  });

  it('sprint: tạo CLOSED theo tên (sequence tiếp nối), issue vào sprint cuối cùng của nó', async () => {
    await runAndWait();
    expect(ctx.prisma.sprint.create).toHaveBeenCalledTimes(3);
    const calls = ctx.prisma.sprint.create.mock.calls as unknown as Array<
      [{ data: { name: string; state: string; sequence: number } }]
    >;
    expect(calls.map((c) => c[0].data.name)).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 3']);
    expect(calls.every((c) => c[0].data.state === 'CLOSED')).toBe(true);
    expect(calls.map((c) => c[0].data.sequence)).toEqual([5, 6, 7]);
    const find = (s: string) => ctx.created.find((p) => p.input.summary === s)!;
    expect(find('Màn hình lịch sử giao dịch').input.sprintId).toBe('sp-Sprint 2'); // Sprint 1 → Sprint 2
    expect(find('Lỗi làm tròn số tiền').input.sprintId).toBe('sp-Sprint 1');
  });

  it('tắt importSprints → không tạo sprint', async () => {
    await runAndWait({
      options: { importComments: true, importSprints: false, keepJiraKey: false, dryRun: false },
    });
    expect(ctx.prisma.sprint.create).not.toHaveBeenCalled();
    expect(ctx.created.every((p) => p.input.sprintId === undefined)).toBe(true);
  });

  it('cập nhật tiến độ mỗi lô và tổng kết COMPLETED', async () => {
    await runAndWait();
    const updates = (
      ctx.prisma.importJob.update.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    ).map((c) => c[0].data);
    expect(
      updates.filter((d) => d.processedItems !== undefined).map((d) => d.processedItems),
    ).toEqual(expect.arrayContaining([20]));
    const done = lastUpdate();
    expect(done).toMatchObject({ status: 'COMPLETED', progress: 100, processedItems: 20 });
    expect(done.result).toMatchObject({
      created: 20,
      failed: 0,
      epics: 2,
      subtasks: 6,
      sprints: 3,
    });
    expect(done.errorLog).toBeNull();
  });

  it('after() trong transaction: ghi ngày/thời gian/label/comment; xoá tệp phân tích khi xong', async () => {
    const analyzeId = await runAndWait();
    expect(existsSync(join(ctx.localDir, 'imports', `${analyzeId}.csv`))).toBe(false);

    const item = ctx.created.find((p) => p.input.summary === 'Tích hợp cổng VNPay')!;
    const tx = {
      issue: { update: vi.fn(() => Promise.resolve({})) },
      issueLabel: { createMany: vi.fn(() => Promise.resolve({})) },
      comment: { createMany: vi.fn(() => Promise.resolve({})) },
    };
    const r = await item.after!(tx as never, { id: 'i1' } as never, new Map());
    expect(r).toEqual({ labels: 3, comments: 2 });
    const upd = (
      tx.issue.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    )[0]![0].data;
    expect((upd.createdAt as Date).toISOString()).toBe('2026-09-03T10:00:00.000Z');
    expect((upd.resolvedAt as Date).toISOString()).toBe('2026-09-20T16:30:00.000Z');
    expect(upd).toMatchObject({
      timeSpent: 25200,
      originalEstimate: 28800,
      resolutionId: 'res-done',
      reporterId: 'u-binh',
      assigneeId: 'u-an',
    });
    const comments = (
      tx.comment.createMany.mock.calls as unknown as Array<
        [{ data: Array<{ authorId: string | null; body: string }> }]
      >
    )[0]![0].data;
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ authorId: 'u-binh', body: 'Đã có tài liệu API.' });
  });

  it('comment của người chưa ghép → authorId null và ghi tên Jira trong nội dung', async () => {
    await runAndWait();
    const item = ctx.created.find((p) => p.input.summary === 'Biểu đồ doanh thu')!;
    const tx = {
      issue: { update: vi.fn(() => Promise.resolve({})) },
      issueLabel: { createMany: vi.fn(() => Promise.resolve({})) },
      comment: { createMany: vi.fn(() => Promise.resolve({})) },
    };
    await item.after!(tx as never, { id: 'i7' } as never, new Map());
    const comments = (
      tx.comment.createMany.mock.calls as unknown as Array<
        [{ data: Array<{ authorId: string | null; body: string }> }]
      >
    )[0]![0].data;
    expect(comments[0]!.authorId).toBeNull();
    expect(comments[0]!.body).toContain('acc-ghost');
  });

  it('dòng lỗi ghi vào errorLog, job vẫn COMPLETED; con của dòng lỗi tạo không có cha kèm cảnh báo', async () => {
    const c = setup({ failSummaries: ['Tích hợp cổng VNPay'] });
    await runAndWait({}, c);
    const done = (
      c.prisma.importJob.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    ).at(-1)![0].data;
    expect(done.status).toBe('COMPLETED');
    expect(done.result).toMatchObject({ created: 19, failed: 1 });
    const log = done.errorLog as string;
    expect(log).toContain('Dòng 3 (PROJ-3): lỗi DB giả lập');
    expect(log).toMatch(/PROJ-15\)\s*\[Cảnh báo\]/);
    const child = c.created.find((p) => p.input.summary === 'Gọi API VNPay: tạo chữ ký')!;
    expect(child.input.parentId).toBeUndefined();
  });

  it('toàn bộ dòng lỗi → FAILED', async () => {
    const all = (await import('./jira-csv.parser')).parseJiraCsv(CSV).issues.map((i) => i.summary);
    const c = setup({ failSummaries: all });
    await runAndWait({}, c);
    const done = (
      c.prisma.importJob.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    ).at(-1)![0].data;
    expect(done.status).toBe('FAILED');
  });

  it('project mới: tạo qua ProjectsService, trạng thái __create__ khớp tên có sẵn rồi mới tạo', async () => {
    const mapping = {
      ...fullMapping(),
      statuses: {
        Done: '__create__',
        'In Progress': '__create__',
        'In Review': '__create__',
        'To Do': '__create__',
      },
    };
    await runAndWait({
      projectId: undefined,
      newProject: { key: 'NEW', name: 'Dự án mới' },
      mapping,
    });
    expect(ctx.projects.create).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ key: 'NEW', name: 'Dự án mới' }),
    );
    // Done / In Progress / To Do khớp tên sẵn có; chỉ "In Review" phải tạo + transition mở từ mọi trạng thái
    expect(ctx.prisma.status.create).toHaveBeenCalledTimes(1);
    const tCalls = ctx.prisma.workflowTransition.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(tCalls[0]![0].data).toMatchObject({
      workflowId: 'wf2',
      fromStatusId: null,
      toStatusId: 's-new-In Review',
    });
    const story = ctx.created.find((p) => p.input.summary === 'Tích hợp cổng VNPay')!;
    expect(story.input.statusId).toBe('s-done');
    expect(
      ctx.created.find((p) => p.input.summary === 'Màn hình lịch sử giao dịch')!.input.statusId,
    ).toBe('s-new-In Review');
  });

  it('lỗi top-level (vd tạo project thất bại) → job FAILED + errorLog, vẫn xoá tệp', async () => {
    ctx.projects.create.mockRejectedValueOnce(new Error('hết chỗ'));
    const mapping = {
      ...fullMapping(),
      statuses: {
        Done: '__create__',
        'In Progress': '__create__',
        'In Review': '__create__',
        'To Do': '__create__',
      },
    };
    const analyzeId = await runAndWait({
      projectId: undefined,
      newProject: { key: 'NEW', name: 'x' },
      mapping,
    });
    const done = lastUpdate();
    expect(done).toMatchObject({ status: 'FAILED', errorLog: 'hết chỗ' });
    expect(existsSync(join(ctx.localDir, 'imports', `${analyzeId}.csv`))).toBe(false);
  });
});
