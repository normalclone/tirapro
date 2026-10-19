import {
  mkdtempSync,
  existsSync,
  readFileSync,
  utimesSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

type ExistingIssue = {
  id: string;
  key: string;
  projectId: string;
  deletedAt: Date | null;
  project: { key: string };
};

function setup(
  opts: {
    failSummaries?: string[];
    /** Việc mà ImportService báo "đụng unique mã" (nhập đồng thời) — nằm trong `duplicates`, không phải `errors`. */
    conflictSummaries?: string[];
    existingIssues?: ExistingIssue[];
  } = {},
) {
  const localDir = mkdtempSync(join(tmpRoot, 'storage-'));
  const created: PreparedItem[] = [];
  const phases: PreparedItem[][] = [];

  const prisma = {
    importJob: {
      create: vi.fn(() => Promise.resolve({ id: 'job1' })),
      update: vi.fn(() => Promise.resolve({})),
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
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
    issue: {
      update: vi.fn(() => Promise.resolve({})),
      // L27: tra mã đã có trong workspace (kể cả việc đã xoá mềm — `// allow-deleted`).
      findMany: vi.fn((args: { where: { key: { in: string[] } } }) =>
        Promise.resolve(
          (opts.existingIssues ?? []).filter((i) => args.where.key.in.includes(i.key)),
        ),
      ),
    },
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
        const duplicates: Array<{ row: number; error: string }> = [];
        let ok = 0;
        for (const it of items) {
          if (opts.conflictSummaries?.includes(it.input.summary)) {
            duplicates.push({ row: it.row, error: 'Unique constraint failed on key' });
            continue;
          }
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
        return { created: ok, labels: 0, comments: 0, errors, duplicates };
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
  pendingEmails: {},
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
    // P5: fullMapping để Lê Minh Cường "Để trống" có chủ đích → không cảnh báo.
    expect((res as { warnings: string[] }).warnings.join('\n')).not.toContain('Lê Minh Cường');
    expect(prisma.importJob.create).not.toHaveBeenCalled();
    expect(projects.create).not.toHaveBeenCalled();
    expect(prisma.sprint.create).not.toHaveBeenCalled();
    expect(prisma.priority.create).not.toHaveBeenCalled();
    expect(prisma.status.create).not.toHaveBeenCalled();
    expect(importService.createIssuesInChunks).not.toHaveBeenCalled();
  });
});

describe('JiraImportService.run — dry-run báo người phụ trách không khớp', () => {
  it('key vắng trong mapping.users → dòng cảnh báo gộp trong warnings', async () => {
    const { service } = setup();
    const { analyzeId } = await service.analyze('w1', 'u1', file());
    const users: Record<string, string | null> = { ...fullMapping().users };
    delete users['Lê Minh Cường'];
    const res = await service.run(
      'w1',
      'u1',
      runInput(analyzeId, {
        mapping: { ...fullMapping(), users },
        options: { importComments: true, importSprints: true, keepJiraKey: false, dryRun: true },
      }),
    );
    expect((res as { warnings: string[] }).warnings.join('\n')).toContain('Lê Minh Cường (4 việc)');
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
    // L27: mã Jira nay là Issue.key (fixedKey) nên KHÔNG còn dòng "Nhập từ Jira: …" trong mô tả.
    expect(story.fixedKey).toBe('PROJ-3');
    expect(story.input.description).toMatch(/^Tích hợp VNPay\./);
    expect(story.input.description).not.toContain('Nhập từ Jira');
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
    // Lê Minh Cường được chủ động chọn "Để trống" ở mapping → không cảnh báo, errorLog rỗng.
    expect(done.errorLog).toBeNull();
  });

  // Mapping người dùng mà Lê Minh Cường KHÔNG có khoá = không khớp thành viên nào (4 việc).
  const unmatchedMapping = (): JiraImportRunInput['mapping'] => {
    const users: Record<string, string | null> = { ...fullMapping().users };
    delete users['Lê Minh Cường'];
    return { ...fullMapping(), users };
  };

  it('P5: key vắng trong mapping.users = không khớp → đếm skippedAssignees + một cảnh báo gộp (không còn "Cảnh báo 0" im lặng)', async () => {
    await runAndWait({ mapping: unmatchedMapping() });
    const done = lastUpdate();
    expect(done.result).toMatchObject({
      warnings: 1,
      skippedAssignees: 4,
      unmatchedAssignees: [{ name: 'Lê Minh Cường', count: 4 }],
      unmatchedAssigneesMore: 0,
      blankedAssignees: 0,
    });
    expect(done.errorLog).toContain('Lê Minh Cường (4 việc)');
    expect(done.errorLog).toContain('KHÔNG có người phụ trách');
  });

  it('P5: key null (chủ động "Để trống") → số trung tính blankedAssignees, KHÔNG tăng warnings/skippedAssignees, không vào errorLog', async () => {
    await runAndWait(); // fullMapping: Lê Minh Cường = null
    const done = lastUpdate();
    expect(done.result).toMatchObject({
      warnings: 0,
      skippedAssignees: 0,
      unmatchedAssignees: [],
      blankedAssignees: 4,
    });
    expect(done.errorLog).toBeNull();
  });

  it('P5: chỉ đếm việc ĐÃ tạo được — dòng lỗi không tính vào skippedAssignees; dòng gộp nằm ĐẦU errorLog', async () => {
    const c = setup({ failSummaries: ['Cấu hình CI/CD'] }); // một việc của Lê Minh Cường bị lỗi
    await runAndWait({ mapping: unmatchedMapping() }, c);
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({
      skippedAssignees: 3,
      unmatchedAssignees: [{ name: 'Lê Minh Cường', count: 3 }],
    });
    const lines = (done.errorLog as string).split('\n');
    expect(lines[0]).toMatch(/^\[Cảnh báo\]: 3 việc/);
    expect(lines.some((l) => l.includes('lỗi DB giả lập'))).toBe(true);
  });

  it('P5: mọi người phụ trách đều khớp → skippedAssignees 0, không cảnh báo, errorLog rỗng', async () => {
    await runAndWait({
      mapping: { ...fullMapping(), users: { ...fullMapping().users, 'Lê Minh Cường': 'u-binh' } },
    });
    const done = lastUpdate();
    expect(done.result).toMatchObject({
      warnings: 0,
      skippedAssignees: 0,
      unmatchedAssignees: [],
      unmatchedAssigneesMore: 0,
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

  it.each([
    ['workspace chưa có loại key EPIC', [], { hierarchyLevel: 1, key: 'EPIC' }],
    [
      'workspace đã có loại key EPIC (tên khác) => không nhân đôi key',
      [{ id: 't-old', name: 'Initiative', key: 'EPIC', isSubtask: false }],
      { hierarchyLevel: 1 },
    ],
  ])('loại Epic Jira __create__: %s', async (_n, existing, expected) => {
    const others = [
      { id: 't-story', name: 'Story', key: 'STORY', isSubtask: false },
      { id: 't-task', name: 'Task', key: 'TASK', isSubtask: false },
      { id: 't-bug', name: 'Bug', key: 'BUG', isSubtask: false },
      { id: 't-sub', name: 'Subtask', key: 'SUBTASK', isSubtask: true },
    ];
    ctx.prisma.issueType.findMany.mockResolvedValue([...others, ...existing] as never);
    ctx.prisma.issueType.create.mockResolvedValue({ id: 't-new' });
    await runAndWait({
      mapping: {
        ...fullMapping(),
        issueTypes: { ...fullMapping().issueTypes, Epic: '__create__' },
      },
    });
    const calls = ctx.prisma.issueType.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const epic = calls.map((c) => c[0].data).find((d) => d.name === 'Epic')!;
    expect(epic).toMatchObject(expected);
    if (!('key' in expected)) expect(epic).not.toHaveProperty('key');
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

describe('JiraImportService.run — chống chạy trùng theo analyzeId', () => {
  async function prepared(c = setup()) {
    const { analyzeId } = await c.service.analyze('w1', 'u1', file());
    return { ...c, analyzeId, input: runInput(analyzeId) };
  }
  const importsDir = (localDir: string) => join(localDir, 'imports');

  it('hai run() song song cùng analyzeId => chỉ MỘT job được tạo, lần hai bị từ chối', async () => {
    const { service, prisma, input } = await prepared();
    const results = await Promise.allSettled([
      service.run('w1', 'u1', input),
      service.run('w1', 'u1', input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(prisma.importJob.create).toHaveBeenCalledTimes(1);
    const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(BusinessRuleException);
    expect((rej.reason as Error).message).toContain('đã (hoặc đang) được import');
    await service.waitForJob('job1');
  });

  it('chạy lần hai khi job đầu còn đang chạy => bị từ chối, chỉ tạo issue một lần', async () => {
    const c = await prepared();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    c.importService.createIssuesInChunks.mockImplementationOnce(async () => {
      await gate;
      return { created: 0, labels: 0, comments: 0, errors: [], duplicates: [] };
    });
    const first = await c.service.run('w1', 'u1', c.input);
    expect(first).toEqual({ jobId: 'job1' });
    await expect(c.service.run('w1', 'u1', c.input)).rejects.toThrow(
      /đã \(hoặc đang\) được import/,
    );
    expect(c.prisma.importJob.create).toHaveBeenCalledTimes(1);
    release();
    await c.service.waitForJob('job1');
    // xong job => tệp (cả .claimed) đã được dọn
    expect(readdirSync(importsDir(c.localDir))).toEqual([]);
  });

  it('dry-run KHÔNG claim: chạy dry-run rồi chạy thật vẫn được', async () => {
    const { service, prisma, input } = await prepared();
    const dry = await service.run('w1', 'u1', {
      ...input,
      options: { ...input.options, dryRun: true },
    });
    expect(dry).toMatchObject({ dryRun: true });
    const real = await service.run('w1', 'u1', input);
    expect(real).toEqual({ jobId: 'job1' });
    expect(prisma.importJob.create).toHaveBeenCalledTimes(1);
    await service.waitForJob('job1');
  });

  it('importJob.create ném lỗi => nhả claim, lần sau chạy lại được', async () => {
    const { service, prisma, input, analyzeId, localDir } = await prepared();
    prisma.importJob.create.mockRejectedValueOnce(new Error('DB sập'));
    await expect(service.run('w1', 'u1', input)).rejects.toThrow('DB sập');
    expect(existsSync(join(importsDir(localDir), `${analyzeId}.json`))).toBe(true);
    expect(existsSync(join(importsDir(localDir), `${analyzeId}.claimed`))).toBe(false);
    await expect(service.run('w1', 'u1', input)).resolves.toEqual({ jobId: 'job1' });
    await service.waitForJob('job1');
  });

  it('rename lỗi không phải ENOENT (vd EACCES) → ném lại lỗi gốc, không báo "đã import"', async () => {
    const c = await prepared();
    const fsp = (await import('node:fs')).promises;
    const spy = vi
      .spyOn(fsp, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
      );
    try {
      const err = await c.service.run('w1', 'u1', c.input).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(BusinessRuleException);
      expect((err as Error).message).toContain('EACCES');
      expect(c.prisma.importJob.create).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('analyzeId đã claim: load() báo "đã/đang được import" thay vì "hết hạn"', async () => {
    const { service, input, analyzeId, localDir } = await prepared();
    await service.run('w1', 'u1', input);
    await service.waitForJob('job1');
    // giả lập trạng thái "đang chạy": chỉ còn tệp claim (json đã đổi tên)
    writeFileSync(join(importsDir(localDir), `${analyzeId}.claimed`), '{}');
    await expect(service.run('w1', 'u1', input)).rejects.toThrow(/đã \(hoặc đang\) được import/);
  });
});

interface FakeJob {
  id: string;
  status: string;
  updatedAt: Date;
  config?: { format?: string };
  errorLog?: string | null;
  completedAt?: Date | null;
}
/** updateMany giả áp đúng điều kiện where (status, updatedAt.lt, id.notIn) lên danh sách job trong bộ nhớ. */
function withFakeJobs(c: ReturnType<typeof setup>, jobs: FakeJob[]) {
  c.prisma.importJob.updateMany.mockImplementation(((args: {
    where: {
      id?: { notIn?: string[] } | string;
      status?: string;
      updatedAt?: { lt: Date };
      config?: { path: string[]; equals: string };
    };
    data: Partial<FakeJob>;
  }) => {
    let count = 0;
    for (const j of jobs) {
      const w = args.where;
      if (w.status && j.status !== w.status) continue;
      if (
        w.config &&
        (j.config as Record<string, unknown> | undefined)?.[w.config.path[0]!] !== w.config.equals
      )
        continue;
      if (w.updatedAt && !(j.updatedAt < w.updatedAt.lt)) continue;
      if (typeof w.id === 'object' && w.id.notIn?.includes(j.id)) continue;
      if (typeof w.id === 'string' && w.id !== j.id) continue;
      Object.assign(j, args.data);
      count++;
    }
    return Promise.resolve({ count });
  }) as never);
  return jobs;
}
const ago = (ms: number) => new Date(Date.now() - ms);
const jira = { format: 'jira-csv' };

describe('JiraImportService — khôi phục job kẹt (heartbeat)', () => {
  it('RUNNING quá hạn (không thuộc node này) => FAILED + errorLog; trả số dòng', async () => {
    const { service, prisma } = setup();
    prisma.importJob.updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    expect(await service.recoverStaleJobs(60_000)).toBe(2);
    const arg = (prisma.importJob.updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({
      status: 'RUNNING',
      updatedAt: { lt: expect.any(Date) as unknown },
    });
    expect(arg.data).toMatchObject({ status: 'FAILED' });
    expect(String(arg.data.errorLog)).toContain('gián đoạn');
  });

  it('job RUNNING có heartbeat mới => KHÔNG bị khôi phục; heartbeat cũ => FAILED', async () => {
    const c = setup();
    const jobs = withFakeJobs(c, [
      // chạy từ lâu nhưng vừa có heartbeat (job lớn ở node khác)
      { id: 'live', status: 'RUNNING', updatedAt: ago(20_000), config: jira },
      { id: 'dead', status: 'RUNNING', updatedAt: ago(10 * 60_000), config: jira },
      { id: 'done', status: 'COMPLETED', updatedAt: ago(10 * 60_000), config: jira },
    ]);
    expect(await c.service.recoverStaleJobs()).toBe(1);
    const by = new Map(jobs.map((j) => [j.id, j]));
    expect(by.get('live')!.status).toBe('RUNNING');
    expect(by.get('dead')!.status).toBe('FAILED');
    expect(by.get('dead')!.errorLog).toContain('gián đoạn');
    expect(by.get('dead')!.completedAt).toBeInstanceOf(Date);
    expect(by.get('done')!.status).toBe('COMPLETED');
  });

  it('chỉ áp lên job Jira: job RUNNING format csv/json/không format với heartbeat cũ KHÔNG bị đụng', async () => {
    const c = setup();
    const jobs = withFakeJobs(c, [
      { id: 'csv', status: 'RUNNING', updatedAt: ago(10 * 60_000), config: {} }, // importCsv: config { projectId }
      {
        id: 'json',
        status: 'RUNNING',
        updatedAt: ago(10 * 60_000),
        config: { format: 'json' },
      },
      { id: 'jira', status: 'RUNNING', updatedAt: ago(10 * 60_000), config: jira },
    ]);
    expect(await c.service.recoverStaleJobs()).toBe(1);
    expect(jobs.map((j) => [j.id, j.status])).toEqual([
      ['csv', 'RUNNING'],
      ['json', 'RUNNING'],
      ['jira', 'FAILED'],
    ]);
    const arg = (c.prisma.importJob.updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({ config: { path: ['format'], equals: 'jira-csv' } });
  });

  it('job Jira thật tạo ra mang đúng config.format để bộ quét nhận ra', async () => {
    const c = setup();
    const { analyzeId } = await c.service.analyze('w1', 'u1', file());
    await c.service.run('w1', 'u1', runInput(analyzeId));
    await c.service.waitForJob('job1');
    const created = (c.prisma.importJob.create.mock.calls[0] as unknown[])[0] as {
      data: { config: { format: string } };
    };
    expect(created.data.config.format).toBe('jira-csv');
    const withConfig = (
      c.prisma.importJob.update.mock.calls as unknown as Array<
        [{ data: { config?: { format?: string } } }]
      >
    ).find((x) => x[0].data.config)![0].data.config!;
    expect(withConfig.format).toBe('jira-csv');
  });

  it('ngưỡng mặc định là 3 phút: 2 phút còn sống, 4 phút bị đánh FAILED', async () => {
    const c = setup();
    const jobs = withFakeJobs(c, [
      { id: 'a', status: 'RUNNING', updatedAt: ago(2 * 60_000), config: jira },
      { id: 'b', status: 'RUNNING', updatedAt: ago(4 * 60_000), config: jira },
    ]);
    await c.service.recoverStaleJobs();
    expect(jobs.map((j) => j.status)).toEqual(['RUNNING', 'FAILED']);
  });
});

describe('JiraImportService — heartbeat và vòng đời job đang chạy', () => {
  it('job đang chạy trong process này không bao giờ bị đánh FAILED dù updatedAt cũ', async () => {
    const c = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    c.importService.createIssuesInChunks.mockImplementationOnce(async () => {
      await gate;
      return { created: 0, labels: 0, comments: 0, errors: [], duplicates: [] };
    });
    const { analyzeId } = await c.service.analyze('w1', 'u1', file());
    await c.service.run('w1', 'u1', runInput(analyzeId));
    const jobs = withFakeJobs(c, [
      { id: 'job1', status: 'RUNNING', updatedAt: ago(60 * 60_000), config: jira },
    ]);
    expect(await c.service.recoverStaleJobs()).toBe(0);
    expect(jobs[0]!.status).toBe('RUNNING');
    release();
    await c.service.waitForJob('job1');
  });

  it('job đang chạy phát heartbeat định kỳ (~30s) kể cả khi một lô kéo dài, và dừng khi xong', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const c = setup();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      c.importService.createIssuesInChunks.mockImplementationOnce(async () => {
        await gate;
        return { created: 0, labels: 0, comments: 0, errors: [], duplicates: [] };
      });
      const { analyzeId } = await c.service.analyze('w1', 'u1', file());
      await c.service.run('w1', 'u1', runInput(analyzeId));
      for (let i = 0; i < 50; i++) await new Promise<void>((r) => setImmediate(r));
      expect(c.importService.createIssuesInChunks).toHaveBeenCalledTimes(1);

      expect(c.prisma.importJob.updateMany).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(65_000);
      const calls = c.prisma.importJob.updateMany.mock.calls as unknown as Array<
        [{ where: Record<string, unknown>; data: { updatedAt: Date } }]
      >;
      expect(calls).toHaveLength(2);
      expect(calls[0]![0].where).toEqual({ id: 'job1', status: 'RUNNING' });
      expect(calls[0]![0].data.updatedAt).toBeInstanceOf(Date);

      release();
      await c.service.waitForJob('job1');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(c.prisma.importJob.updateMany).toHaveBeenCalledTimes(2); // timer đã bị clear
    } finally {
      vi.useRealTimers();
    }
  });

  it('onApplicationBootstrap gọi recoverStaleJobs và không ném khi DB lỗi', async () => {
    const c = setup();
    await c.service.onApplicationBootstrap();
    expect(c.prisma.importJob.updateMany).toHaveBeenCalledTimes(1);
    c.prisma.importJob.updateMany.mockRejectedValueOnce(new Error('DB chưa sẵn sàng'));
    await expect(c.service.onApplicationBootstrap()).resolves.toBeUndefined();
    c.prisma.importJob.updateMany.mockRejectedValueOnce(new Error('DB chưa sẵn sàng'));
    await expect(c.service.sweepStaleJobs()).resolves.toBeUndefined();
  });
});

describe('JiraImportService — mã Jira thật làm Issue.key (L27)', () => {
  const existing = (key: string, over: Partial<ExistingIssue> = {}): ExistingIssue => ({
    id: `old-${key}`,
    key,
    projectId: 'p1',
    deletedAt: null,
    project: { key: 'PROJ' },
    ...over,
  });
  const csvWith = (edit: (text: string) => string): Buffer =>
    Buffer.from(edit(CSV.toString('utf8')), 'utf8');

  async function runAndWait(
    c: ReturnType<typeof setup>,
    patch: Partial<JiraImportRunInput> = {},
    buf: Buffer = CSV,
  ) {
    const { analyzeId } = await c.service.analyze('w1', 'u1', file(buf));
    const res = await c.service.run('w1', 'u1', runInput(analyzeId, patch));
    if ('jobId' in res) await c.service.waitForJob(res.jobId);
    return res;
  }
  const lastUpdate = (c: ReturnType<typeof setup>) =>
    (
      c.prisma.importJob.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    ).at(-1)![0].data;
  const createdKeys = (c: ReturnType<typeof setup>) => c.created.map((p) => p.fixedKey);
  const off = { importComments: true, importSprints: true, keepJiraKey: false, dryRun: false };

  it('keepJiraKey bật: mỗi việc mang fixedKey = mã Jira, mô tả không có "Nhập từ Jira"', async () => {
    const c = setup();
    await runAndWait(c);
    expect(c.created).toHaveLength(20);
    const keys = createdKeys(c);
    expect(keys).toContain('PROJ-1');
    expect(keys).toContain('PROJ-20');
    expect(c.created.every((p) => !p.input.description?.includes('Nhập từ Jira'))).toBe(true);
    expect(lastUpdate(c).result).toMatchObject({ created: 20, duplicateKeys: 0, invalidKeys: 0 });
  });

  it('keepJiraKey tắt: không fixedKey (mã Tirapro tự sinh), mô tả cũng không có dòng "Nhập từ Jira"', async () => {
    const c = setup();
    await runAndWait(c, { options: off });
    expect(c.created.every((p) => p.fixedKey === undefined)).toBe(true);
    expect(c.created.every((p) => !p.input.description?.includes('Nhập từ Jira'))).toBe(true);
    expect(c.prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('đã có sẵn PROJ-1 trong workspace → bỏ qua dòng đó, cảnh báo trong errorLog, duplicateKeys = 1', async () => {
    const c = setup({ existingIssues: [existing('PROJ-1')] });
    await runAndWait(c);
    expect(createdKeys(c)).not.toContain('PROJ-1');
    expect(c.created).toHaveLength(19);
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({ created: 19, failed: 0, duplicateKeys: 1 });
    expect(done.errorLog as string).toContain('Dòng 1 (PROJ-1) [Cảnh báo]: Mã PROJ-1 đã tồn tại');
    expect(done.errorLog as string).toContain('bỏ qua');
    expect(done.status).toBe('COMPLETED');
    // tra mã theo workspace, kể cả việc đã xoá mềm (unique vẫn giữ mã)
    const where = (
      c.prisma.issue.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({ workspaceId: 'w1' });
    expect(JSON.stringify(where)).not.toContain('deletedAt');
  });

  it('việc đã xoá mềm giữ mã → vẫn coi là trùng, ghi chú nằm trong Thùng rác', async () => {
    const c = setup({ existingIssues: [existing('PROJ-2', { deletedAt: new Date() })] });
    await runAndWait(c);
    expect(createdKeys(c)).not.toContain('PROJ-2');
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({ duplicateKeys: 1 });
    expect(done.errorLog as string).toContain('Thùng rác');
  });

  it('mã trùng ở dự án khác → bỏ qua; nhật ký job KHÔNG nêu mã dự án khác (có thể riêng tư), dry-run (chỉ quản trị) thì nêu', async () => {
    const c = setup({
      existingIssues: [existing('PROJ-4', { projectId: 'p-other', project: { key: 'OTH' } })],
    });
    await runAndWait(c);
    expect(createdKeys(c)).not.toContain('PROJ-4');
    const log = lastUpdate(c).errorLog as string;
    expect(log).toContain('một dự án khác');
    expect(log).not.toContain('OTH');
    const d = setup({
      existingIssues: [existing('PROJ-4', { projectId: 'p-other', project: { key: 'OTH' } })],
    });
    const res = (await runAndWait(d, {
      options: { importComments: true, importSprints: true, keepJiraKey: true, dryRun: true },
    })) as { warnings: string[] };
    expect(res.warnings.join('\n')).toContain('dự án OTH');
  });

  it('mã lặp hai lần trong tệp → dòng sau bị bỏ qua, dòng đầu vẫn tạo', async () => {
    const c = setup();
    const buf = csvWith((t) =>
      t.replace('Tài liệu hướng dẫn triển khai,PROJ-9,', 'Tài liệu hướng dẫn triển khai,PROJ-8,'),
    );
    await runAndWait(c, {}, buf);
    expect(createdKeys(c).filter((k) => k === 'PROJ-8')).toHaveLength(1);
    expect(c.created.map((p) => p.input.summary)).toContain('Cấu hình CI/CD');
    expect(c.created.map((p) => p.input.summary)).not.toContain('Tài liệu hướng dẫn triển khai');
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({ created: 19, duplicateKeys: 1 });
    expect(done.errorLog as string).toContain('lặp lại trong tệp');
  });

  it('mã sai dạng (PROJ-STORY-10) → vẫn tạo với mã Tirapro tự sinh, invalidKeys = 1, có cảnh báo', async () => {
    const c = setup();
    const buf = csvWith((t) =>
      t.replace('Sửa lỗi đăng nhập SSO,PROJ-10,', 'Sửa lỗi đăng nhập SSO,PROJ-STORY-10,'),
    );
    await runAndWait(c, {}, buf);
    expect(c.created).toHaveLength(20);
    const bad = c.created.find((p) => p.input.summary === 'Sửa lỗi đăng nhập SSO')!;
    expect(bad.fixedKey).toBeUndefined();
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({ created: 20, invalidKeys: 1, duplicateKeys: 0 });
    expect(done.errorLog as string).toContain('PROJ-STORY-10');
  });

  it('chữ thường trong tệp được chuẩn hoá HOA', async () => {
    const c = setup();
    const buf = csvWith((t) =>
      t.replace('Thiết kế lại trang chủ,PROJ-14,', 'Thiết kế lại trang chủ,proj-14,'),
    );
    await runAndWait(c, {}, buf);
    expect(createdKeys(c)).toContain('PROJ-14');
  });

  it('con của dòng bị bỏ qua (cùng dự án đích) vẫn gắn đúng cha là việc đã có', async () => {
    const c = setup({ existingIssues: [existing('PROJ-3')] });
    await runAndWait(c);
    const child = c.created.find((p) => p.input.summary === 'Gọi API VNPay: tạo chữ ký')!;
    expect(child.input.parentId).toBe('old-PROJ-3');
    // epic cha bị bỏ qua cùng dự án: story vẫn gắn epic đã có
    const c2 = setup({ existingIssues: [existing('PROJ-1')] });
    await runAndWait(c2);
    const story = c2.created.find((p) => p.input.summary === 'Tích hợp cổng VNPay')!;
    expect(story.input.epicId).toBe('old-PROJ-1');
  });

  it('cha trùng mã nhưng thuộc dự án KHÁC → không gắn, cảnh báo "tạo không có việc cha"', async () => {
    const c = setup({
      existingIssues: [existing('PROJ-3', { projectId: 'p-other', project: { key: 'OTH' } })],
    });
    await runAndWait(c);
    const child = c.created.find((p) => p.input.summary === 'Gọi API VNPay: tạo chữ ký')!;
    expect(child.input.parentId).toBeUndefined();
    expect(lastUpdate(c).errorLog as string).toContain('tạo không có việc cha');
  });
});

describe('JiraImportService — mã Jira thật làm Issue.key (L27) — cha/con, nhập lại, dry-run', () => {
  const existing = (key: string, over: Partial<ExistingIssue> = {}): ExistingIssue => ({
    id: `old-${key}`,
    key,
    projectId: 'p1',
    deletedAt: null,
    project: { key: 'PROJ' },
    ...over,
  });
  const csvWith = (edit: (text: string) => string): Buffer =>
    Buffer.from(edit(CSV.toString('utf8')), 'utf8');

  async function runAndWait(
    c: ReturnType<typeof setup>,
    patch: Partial<JiraImportRunInput> = {},
    buf: Buffer = CSV,
  ) {
    const { analyzeId } = await c.service.analyze('w1', 'u1', file(buf));
    const res = await c.service.run('w1', 'u1', runInput(analyzeId, patch));
    if ('jobId' in res) await c.service.waitForJob(res.jobId);
    return res;
  }
  const lastUpdate = (c: ReturnType<typeof setup>) =>
    (
      c.prisma.importJob.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    ).at(-1)![0].data;
  const off = { importComments: true, importSprints: true, keepJiraKey: false, dryRun: false };

  it('việc cha đã xoá mềm (cùng dự án) → không gắn làm cha', async () => {
    const c = setup({ existingIssues: [existing('PROJ-3', { deletedAt: new Date() })] });
    await runAndWait(c);
    const child = c.created.find((p) => p.input.summary === 'Gọi API VNPay: tạo chữ ký')!;
    expect(child.input.parentId).toBeUndefined();
  });

  it('nhập lại cùng tệp (mọi mã đã có) → không tạo gì, job COMPLETED (không FAILED), duplicateKeys = 20', async () => {
    const all = Array.from({ length: 20 }, (_, i) => existing(`PROJ-${i + 1}`));
    const c = setup({ existingIssues: all });
    await runAndWait(c);
    expect(c.created).toHaveLength(0);
    const done = lastUpdate(c);
    expect(done).toMatchObject({ status: 'COMPLETED', progress: 100, processedItems: 20 });
    expect(done.result).toMatchObject({ created: 0, failed: 0, duplicateKeys: 20 });
  });

  it('dry-run: không ghi gì nhưng đếm duplicateKeys/invalidKeys và liệt kê cảnh báo', async () => {
    const c = setup({ existingIssues: [existing('PROJ-1'), existing('PROJ-2')] });
    const buf = csvWith((t) =>
      t.replace('Sửa lỗi đăng nhập SSO,PROJ-10,', 'Sửa lỗi đăng nhập SSO,PROJ-STORY-10,'),
    );
    const res = await runAndWait(
      c,
      { options: { importComments: true, importSprints: true, keepJiraKey: true, dryRun: true } },
      buf,
    );
    expect(res).toMatchObject({ dryRun: true, total: 20, duplicateKeys: 2, invalidKeys: 1 });
    const warnings = (res as { warnings: string[] }).warnings.join('\n');
    expect(warnings).toContain('PROJ-1 đã tồn tại');
    expect(c.prisma.importJob.create).not.toHaveBeenCalled();
    expect(c.importService.createIssuesInChunks).not.toHaveBeenCalled();
  });

  it('dry-run với keepJiraKey tắt: duplicateKeys = 0, không tra mã', async () => {
    const c = setup({ existingIssues: [existing('PROJ-1')] });
    const res = await runAndWait(c, { options: { ...off, dryRun: true } });
    expect(res).toMatchObject({ dryRun: true, duplicateKeys: 0, invalidKeys: 0 });
    expect(c.prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('trùng mã lọt qua bước tra (nhập đồng thời, P2002) → tính là trùng + cảnh báo, không phải failed', async () => {
    const c = setup({ conflictSummaries: ['Cấu hình CI/CD'] });
    await runAndWait(c);
    const done = lastUpdate(c);
    expect(done).toMatchObject({ status: 'COMPLETED' });
    expect(done.result).toMatchObject({ created: 19, failed: 0, duplicateKeys: 1 });
    expect(done.errorLog as string).toContain(
      'Dòng 8 (PROJ-8) [Cảnh báo]: Mã vừa được một lượt nhập khác tạo',
    );
  });
});

describe('JiraImportService — nhớ email người phụ trách chưa có (L28)', () => {
  // Lê Minh Cường có 4 việc trong tệp mẫu; bỏ khoá = "chưa ghép".
  const unmatched = (pendingEmails: Record<string, string>): JiraImportRunInput['mapping'] => {
    const users: Record<string, string | null> = { ...fullMapping().users };
    delete users['Lê Minh Cường'];
    return { ...fullMapping(), users, pendingEmails };
  };
  const withEmail = () => unmatched({ 'Lê Minh Cường': 'Cuong@X.com' });

  async function runAndWait(
    c: ReturnType<typeof setup>,
    mapping: JiraImportRunInput['mapping'],
    options?: Partial<JiraImportRunInput['options']>,
  ) {
    const { analyzeId } = await c.service.analyze('w1', 'u1', file());
    const res = await c.service.run(
      'w1',
      'u1',
      runInput(analyzeId, { mapping, options: { ...runInput(analyzeId).options, ...options } }),
    );
    if ('jobId' in res) await c.service.waitForJob(res.jobId);
    return res;
  }
  const lastUpdate = (c: ReturnType<typeof setup>) =>
    (
      c.prisma.importJob.update.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    ).at(-1)![0].data;
  const txMock = () => ({
    issue: { update: vi.fn(() => Promise.resolve({})) },
    issueLabel: { createMany: vi.fn(() => Promise.resolve({})) },
    comment: { createMany: vi.fn(() => Promise.resolve({})) },
    importPendingAssignee: { create: vi.fn(() => Promise.resolve({})) },
  });
  const afterFor = async (c: ReturnType<typeof setup>, summary: string) => {
    const tx = txMock();
    const item = c.created.find((p) => p.input.summary === summary)!;
    await item.after!(tx as never, { id: 'i1' } as never, new Map());
    return tx;
  };

  it('người chưa ghép có email → ghi hàng chờ trong cùng transaction (email chữ thường, gắn việc/dự án/workspace)', async () => {
    const c = setup();
    await runAndWait(c, withEmail());
    const tx = await afterFor(c, 'Cấu hình CI/CD'); // việc của Lê Minh Cường
    expect(tx.importPendingAssignee.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'w1',
        projectId: 'p1',
        issueId: 'i1',
        email: 'cuong@x.com',
        sourceName: 'Lê Minh Cường',
      },
    });
  });

  it('không có trong pendingEmails → không tạo hàng chờ (hành vi cũ: bỏ gán + cảnh báo)', async () => {
    const c = setup();
    await runAndWait(c, unmatched({}));
    const tx = await afterFor(c, 'Cấu hình CI/CD');
    expect(tx.importPendingAssignee.create).not.toHaveBeenCalled();
    expect(lastUpdate(c).result).toMatchObject({
      skippedAssignees: 4,
      rememberedAssignees: 0,
    });
  });

  it('người đã ghép hoặc chủ động "Để trống" thì bỏ qua pendingEmails', async () => {
    const c = setup();
    // fullMapping: Cường = null (Để trống cố ý), Bình = u-binh (đã ghép) — cả hai kèm email thừa
    await runAndWait(c, {
      ...fullMapping(),
      pendingEmails: { 'Lê Minh Cường': 'cuong@x.com', 'Trần Thị Bình': 'binh@x.com' },
    });
    expect(
      (await afterFor(c, 'Cấu hình CI/CD')).importPendingAssignee.create,
    ).not.toHaveBeenCalled();
    expect(
      (await afterFor(c, 'Lỗi làm tròn số tiền')).importPendingAssignee.create,
    ).not.toHaveBeenCalled();
    expect(lastUpdate(c).result).toMatchObject({ rememberedAssignees: 0 });
  });

  it('kết quả: skippedAssignees vẫn đếm (chưa có người), rememberedAssignees đếm riêng; cảnh báo "KHÔNG có người" không còn cho họ', async () => {
    const c = setup();
    await runAndWait(c, withEmail());
    const done = lastUpdate(c);
    expect(done.result).toMatchObject({
      skippedAssignees: 4,
      rememberedAssignees: 4,
      unmatchedAssignees: [],
      warnings: 0,
    });
    expect(done.errorLog as string).toContain('[Ghi chú]');
    // result/errorLog đọc được qua import:run → KHÔNG chứa email
    expect(JSON.stringify(done.result)).not.toContain('cuong@x.com');
    expect(done.errorLog as string).not.toContain('cuong@x.com');
    expect(done.result).not.toHaveProperty('rememberedEmails');
    expect(done.errorLog as string).not.toContain('KHÔNG có người phụ trách');
  });

  it('một người có email, một người không: cảnh báo chỉ nêu người không có email', async () => {
    const c = setup();
    const users: Record<string, string | null> = { ...fullMapping().users };
    delete users['Lê Minh Cường'];
    delete users['Trần Thị Bình'];
    await runAndWait(c, {
      ...fullMapping(),
      users,
      pendingEmails: { 'Lê Minh Cường': 'cuong@x.com' },
    });
    const done = lastUpdate(c);
    const r = done.result as {
      unmatchedAssignees: Array<{ name: string }>;
      skippedAssignees: number;
    };
    expect(r.unmatchedAssignees.map((u) => u.name)).toEqual(['Trần Thị Bình']);
    expect(r.skippedAssignees).toBeGreaterThan(4);
    expect(done.errorLog as string).toContain('Trần Thị Bình');
  });

  it('dry-run: báo "N việc sẽ tự gán khi họ được thêm", đếm rememberedAssignees, không ghi gì', async () => {
    const c = setup();
    const res = (await runAndWait(c, withEmail(), { dryRun: true })) as {
      warnings: string[];
      rememberedAssignees: number;
    };
    expect(res.rememberedAssignees).toBe(4);
    const text = res.warnings.join('\n');
    expect(text).toContain('4 việc sẽ tự gán');
    expect(text).toContain('cuong@x.com');
    expect(text).not.toContain('Lê Minh Cường (4 việc)'); // không còn vào cảnh báo "không khớp"
    expect(c.prisma.importJob.create).not.toHaveBeenCalled();
  });
});
