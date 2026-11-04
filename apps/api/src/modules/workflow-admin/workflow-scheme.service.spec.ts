import { describe, expect, it, vi } from 'vitest';
import { WorkflowResolver } from './workflow-resolver.service';
import { WorkflowSchemeService } from './workflow-scheme.service';

type Cat = 'TODO' | 'IN_PROGRESS' | 'DONE';
interface St {
  id: string;
  workflowId: string;
  name: string;
  category: Cat;
  order: number;
  isInitial: boolean;
  color?: string | null;
}
const st = (
  id: string,
  workflowId: string,
  name: string,
  category: Cat,
  order: number,
  isInitial = false,
): St => ({
  id,
  workflowId,
  name,
  category,
  order,
  isInitial,
  color: null,
});

const TASK_TYPE = {
  id: 'tTask',
  name: 'Task',
  key: 'TASK',
  color: null,
  isSubtask: false,
  hierarchyLevel: 0,
};

type WorldOver = {
  scheme?: Array<{ issueTypeId: string; workflowId: string }>;
  overrides?: Array<{ projectId: string; issueTypeId: string; workflowId: string }>;
  archived?: boolean;
  existingCopy?: boolean;
  rules?: Array<Record<string, unknown>>;
};

/** Dữ liệu nền của thế giới giả (quy trình, trạng thái, việc, dự án, cấu hình, quy tắc) — các bảng giả đọc/ghi trên đây. */
function worldData(over: WorldOver) {
  const statuses: St[] = [
    st('o1', 'wfOld', 'Cần làm', 'TODO', 0, true),
    st('o2', 'wfOld', 'Đang làm', 'IN_PROGRESS', 1),
    st('o3', 'wfOld', 'Hoàn thành', 'DONE', 2),
    st('s1', 'wfStd', 'To Do', 'TODO', 0, true),
    st('s2', 'wfStd', 'In Progress', 'IN_PROGRESS', 1),
    st('s3', 'wfStd', 'Done', 'DONE', 2),
  ];
  const transitions = [
    {
      id: 'tr1',
      workflowId: 'wfStd',
      name: 'Bắt đầu',
      fromStatusId: 's1',
      toStatusId: 's2',
      order: 0,
    },
    {
      id: 'tr2',
      workflowId: 'wfStd',
      name: 'Xong',
      fromStatusId: null,
      toStatusId: 's3',
      order: 1,
    },
  ];
  const workflows = [
    {
      id: 'wfOld',
      organizationId: 'w1',
      projectId: null,
      name: 'Phát triển phần mềm',
      description: null,
      isTemplate: false,
    },
    {
      id: 'wfStd',
      organizationId: 'w1',
      projectId: null,
      name: 'Standard Workflow',
      description: 'd',
      isTemplate: false,
    },
  ] as Array<Record<string, unknown>>;
  if (over.existingCopy) {
    workflows.push({
      id: 'cp',
      organizationId: 'w1',
      projectId: 'p2',
      name: 'Standard Workflow (TI)',
      description: 'd',
      isTemplate: false,
    });
    statuses.push(
      st('c1', 'cp', 'To Do', 'TODO', 0, true),
      st('c2', 'cp', 'In Progress', 'IN_PROGRESS', 1),
      st('c3', 'cp', 'Done', 'DONE', 2),
    );
  }
  const issues = [
    ...[1, 2, 3].map((n) => ({ id: `a${n}`, projectId: 'p1', typeId: 'tTask', statusId: 'o2' })),
    { id: 'b1', projectId: 'p1', typeId: 'tTask', statusId: 'o1' },
    ...[1, 2].map((n) => ({ id: `c${n}`, projectId: 'p2', typeId: 'tTask', statusId: 'o2' })),
  ];
  const projects = [
    { id: 'p1', key: 'KY', organizationId: 'w1', defaultWorkflowId: 'wfOld' },
    { id: 'p2', key: 'TI', organizationId: 'w1', defaultWorkflowId: 'wfOld' },
  ];
  const scheme = [...(over.scheme ?? [])];
  const overrides = [...(over.overrides ?? [])];
  const rules = (over.rules ?? []).map((r) => ({
    projectId: null,
    createdById: 'u-rule',
    enabled: true,
    triggerConfig: {},
    conditions: [],
    actions: [],
    ...r,
  })) as unknown as Array<Record<string, unknown> & { id: string }>;
  const wfOf = (statusId: string) => statuses.find((s) => s.id === statusId)!.workflowId;
  return {
    statuses,
    transitions,
    workflows,
    issues,
    projects,
    scheme,
    overrides,
    rules,
    wfOf,
    ids: { next: 0 },
  };
}

type WorldData = ReturnType<typeof worldData>;

/** Bảng quy trình / trạng thái / cấu hình tổ chức / ghi đè dự án của prisma giả. */
function workflowModels(d: WorldData) {
  const { statuses, transitions, workflows, scheme, overrides, ids } = d;
  return {
    issueType: {
      findMany: vi.fn((a: { where: { id?: { in: string[] } } }) =>
        Promise.resolve([TASK_TYPE].filter((t) => !a.where.id || a.where.id.in.includes(t.id))),
      ),
      findFirst: vi.fn((a: { where: { id: string } }) =>
        Promise.resolve(a.where.id === 'tTask' ? TASK_TYPE : null),
      ),
    },
    workflow: {
      count: vi.fn((a: { where: { id: { in: string[] }; projectId: null } }) =>
        Promise.resolve(
          workflows.filter((w) => a.where.id.in.includes(w.id as string) && w.projectId === null)
            .length,
        ),
      ),
      findFirst: vi.fn(
        (a: {
          where: {
            id?: string;
            name?: string;
            projectId?: string;
            OR?: Array<{ projectId: unknown }>;
          };
        }) => {
          const w = workflows.find((x) =>
            a.where.id
              ? x.id === a.where.id &&
                (!a.where.OR || a.where.OR.some((o) => o.projectId === x.projectId))
              : x.name === a.where.name && x.projectId === a.where.projectId,
          );
          if (!w) return Promise.resolve(null);
          return Promise.resolve({
            ...w,
            statuses: statuses.filter((s) => s.workflowId === w.id),
            transitions: transitions.filter((t) => t.workflowId === w.id),
          });
        },
      ),
      create: vi.fn((a: { data: Record<string, unknown> }) => {
        const row = { id: `cp${++ids.next}`, ...a.data };
        workflows.push(row);
        return Promise.resolve({ id: row.id });
      }),
    },
    status: {
      findMany: vi.fn(
        (a: { where: { id?: { in: string[] }; workflowId?: string | { in: string[] } } }) => {
          const wf = a.where.workflowId;
          const inWf = (id: string) =>
            typeof wf === 'string' ? id === wf : (wf?.in ?? []).includes(id);
          return Promise.resolve(
            statuses.filter((s) =>
              a.where.id ? a.where.id.in.includes(s.id) : inWf(s.workflowId),
            ),
          );
        },
      ),
      count: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(statuses.filter((s) => a.where.id.in.includes(s.id)).length),
      ),
      create: vi.fn((a: { data: Omit<St, 'id'> }) => {
        const row: St = { id: `n${++ids.next}`, ...a.data };
        statuses.push(row);
        return Promise.resolve({ id: row.id });
      }),
    },
    workflowTransition: {
      create: vi.fn((_a: { data: Record<string, unknown> }) => Promise.resolve({})),
    },
    organizationWorkflowScheme: {
      findMany: vi.fn(() => Promise.resolve(scheme.map((s) => ({ ...s })))),
      findUnique: vi.fn((a: { where: { organizationId_issueTypeId: { issueTypeId: string } } }) =>
        Promise.resolve(
          scheme.find((s) => s.issueTypeId === a.where.organizationId_issueTypeId.issueTypeId) ??
            null,
        ),
      ),
      upsert: vi.fn((a: { create: { issueTypeId: string; workflowId: string } }) => {
        const i = scheme.findIndex((s) => s.issueTypeId === a.create.issueTypeId);
        if (i >= 0) scheme[i]!.workflowId = a.create.workflowId;
        else scheme.push({ issueTypeId: a.create.issueTypeId, workflowId: a.create.workflowId });
        return Promise.resolve({});
      }),
    },
    projectWorkflowOverride: {
      findMany: vi.fn((a: { where: { projectId?: string } }) =>
        Promise.resolve(
          overrides.filter((o) => !a.where.projectId || o.projectId === a.where.projectId),
        ),
      ),
      findUnique: vi.fn(
        (a: { where: { projectId_issueTypeId: { projectId: string; issueTypeId: string } } }) =>
          Promise.resolve(
            overrides.find(
              (o) =>
                o.projectId === a.where.projectId_issueTypeId.projectId &&
                o.issueTypeId === a.where.projectId_issueTypeId.issueTypeId,
            ) ?? null,
          ),
      ),
      upsert: vi.fn(
        (a: { create: { projectId: string; issueTypeId: string; workflowId: string } }) => {
          const i = overrides.findIndex(
            (o) => o.projectId === a.create.projectId && o.issueTypeId === a.create.issueTypeId,
          );
          if (i >= 0) overrides[i]!.workflowId = a.create.workflowId;
          else overrides.push({ ...a.create });
          return Promise.resolve({});
        },
      ),
      deleteMany: vi.fn((a: { where: { projectId: string; issueTypeId: string } }) => {
        const i = overrides.findIndex(
          (o) => o.projectId === a.where.projectId && o.issueTypeId === a.where.issueTypeId,
        );
        if (i >= 0) overrides.splice(i, 1);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
}

/** Bảng dự án / việc / lịch sử của prisma giả. */
function issueModels(d: WorldData, archived: boolean | undefined) {
  const { issues, projects, wfOf } = d;
  return {
    project: {
      findMany: vi.fn(() => Promise.resolve(projects)),
      findFirst: vi.fn((a: { where: { id: string } }) =>
        Promise.resolve(projects.find((p) => p.id === a.where.id) ?? null),
      ),
      findUnique: vi.fn((a: { where: { id: string } }) => {
        const p = projects.find((x) => x.id === a.where.id);
        return Promise.resolve(p && { ...p, archivedAt: archived ? new Date() : null });
      }),
    },
    issue: {
      groupBy: vi.fn(
        (a: {
          by: string[];
          where: {
            typeId: string;
            statusId?: { in: string[] };
            projectId: { in: string[] };
            status: { workflowId: { not: string } };
          };
        }) => {
          if (a.by.length === 1) {
            // "còn việc ở trạng thái cũ?" (giữ id cũ trong quy tắc)
            const m = new Map<string, number>();
            for (const i of issues)
              if (a.where.statusId?.in.includes(i.statusId))
                m.set(i.statusId, (m.get(i.statusId) ?? 0) + 1);
            return Promise.resolve(
              [...m].map(([statusId, n]) => ({ statusId, _count: { _all: n } })),
            );
          }
          const m = new Map<string, number>();
          for (const i of issues)
            if (
              i.typeId === a.where.typeId &&
              a.where.projectId.in.includes(i.projectId) &&
              wfOf(i.statusId) !== a.where.status.workflowId.not
            )
              m.set(
                `${i.projectId}|${i.statusId}`,
                (m.get(`${i.projectId}|${i.statusId}`) ?? 0) + 1,
              );
          return Promise.resolve(
            [...m].map(([k, n]) => ({
              projectId: k.split('|')[0]!,
              statusId: k.split('|')[1]!,
              _count: { _all: n },
            })),
          );
        },
      ),
      findMany: vi.fn((a: { where: { typeId: string; projectId: string; statusId: string } }) =>
        Promise.resolve(
          issues
            .filter(
              (i) =>
                i.typeId === a.where.typeId &&
                i.projectId === a.where.projectId &&
                i.statusId === a.where.statusId,
            )
            .map((i) => ({ id: i.id, projectId: i.projectId, sprintId: null, resolutionId: null })),
        ),
      ),
      updateMany: vi.fn((a: { where: { id: { in: string[] } }; data: { statusId: string } }) => {
        for (const i of issues) if (a.where.id.in.includes(i.id)) i.statusId = a.data.statusId;
        return Promise.resolve({ count: a.where.id.in.length });
      }),
    },
    issueHistory: {
      createMany: vi.fn((_a: { data: Array<Record<string, unknown>> }) =>
        Promise.resolve({ count: 0 }),
      ),
    },
    resolution: { findFirst: vi.fn(() => Promise.resolve({ id: 'r-def' })) },
  };
}

/**
 * Thế giới giả: quy trình cũ `wfOld` (Cần làm / Đang làm / Hoàn thành) + quy trình tổ chức `wfStd` (To Do / In Progress / Done).
 * Loại Task (`tTask`). Dự án p1 (KY) theo tổ chức, p2 (TI) đã ghi đè cho Task. Việc: p1 có 1 ở "Cần làm", 3 ở "Đang làm";
 * p2 có 2 ở "Đang làm".
 */
function world(over: WorldOver = {}) {
  const d = worldData(over);
  const { statuses, workflows, scheme, overrides, issues, rules } = d;
  const prisma = {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn((..._a: unknown[]) => Promise.resolve(0)),
    user: { upsert: vi.fn(() => Promise.resolve({ id: 'SYS' })) },
    automationRule: {
      findMany: vi.fn(() => Promise.resolve(rules.map((r) => ({ ...r })))),
      update: vi.fn((a: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(rules.find((r) => r.id === a.where.id)!, a.data);
        return Promise.resolve({});
      }),
    },
    ...workflowModels(d),
    ...issueModels(d, over.archived),
    // Tham chiếu theo TÊN trạng thái trong JQL (chỉ báo): bộ lọc đã lưu "Đang làm" sẽ hết khớp, "Done" thì không.
    savedFilter: {
      findMany: vi.fn(() =>
        Promise.resolve([
          { id: 'f1', name: 'Đang làm của tôi', jql: 'status = "Đang làm"' },
          { id: 'f2', name: 'Đã xong', jql: 'status = Done' },
        ]),
      ),
    },
    widget: { findMany: vi.fn(() => Promise.resolve([])) },
    keyResult: { findMany: vi.fn(() => Promise.resolve([])) },
    board: { findMany: vi.fn((_a: { where: { projectId: string } }) => Promise.resolve([])) },
    boardColumn: { findMany: vi.fn(() => Promise.resolve([])) },
    boardColumnStatus: {
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      findMany: vi.fn(() => Promise.resolve([])),
      groupBy: vi.fn(() => Promise.resolve([])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
  };
  const resolver = new WorkflowResolver();
  const invalidate = vi.spyOn(resolver, 'invalidate');
  const published: Array<{ recipientId: string; payload: unknown; force?: boolean }> = [];
  const notifications = {
    publish: vi.fn((n: { recipientId: string; payload: unknown }, o?: { force?: boolean }) => {
      published.push({ ...n, force: o?.force });
      return Promise.resolve();
    }),
  };
  const events = { emit: vi.fn() };
  const access = { visibleProjectIds: vi.fn(() => Promise.resolve(null)) };
  const service = new WorkflowSchemeService(
    prisma as never,
    resolver,
    access as never,
    notifications as never,
    events as never,
  );
  return {
    service,
    prisma,
    invalidate,
    issues,
    scheme,
    overrides,
    statuses,
    workflows,
    rules,
    published,
    events,
  };
}

const items = [{ issueTypeId: 'tTask', workflowId: 'wfStd' }];
const sortRows = <T extends { projectKey: string; fromStatusId: string }>(r: T[]) =>
  [...r].sort((a, b) =>
    (a.projectKey + a.fromStatusId).localeCompare(b.projectKey + b.fromStatusId),
  );
const rejects = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) =>
      e as {
        status: number;
        response: { code: string; details?: Array<{ field: string; suggestedStatusId?: string }> };
      },
  );

describe('WorkflowSchemeService.setOrganizationScheme', () => {
  it('dryRun: bảng việc sẽ chuyển (đếm theo dự án/trạng thái), bỏ dự án có ghi đè, không ghi gì', async () => {
    const w = world({
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    const out = await w.service.setOrganizationScheme('w1', 'u1', { items }, true);
    expect(out.dryRun).toBe(true);
    expect(out.totalIssues).toBe(4);
    expect(
      sortRows(out.moves).map((m) => [
        m.projectKey,
        m.fromStatusName,
        m.toStatusName,
        m.count,
        m.suggested,
      ]),
    ).toEqual([
      ['KY', 'Cần làm', 'To Do', 1, true],
      ['KY', 'Đang làm', 'In Progress', 3, true],
    ]);
    expect(w.prisma.organizationWorkflowScheme.upsert).not.toHaveBeenCalled();
    expect(w.prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(w.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('chạy thật thiếu statusMap => 422 STATUS_MAPPING_REQUIRED kèm gợi ý cho từng trạng thái cũ; chưa ghi gì; cache được bỏ', async () => {
    const w = world();
    const err = await rejects(w.service.setOrganizationScheme('w1', 'u1', { items }, false));
    expect(err!.status).toBe(422);
    expect(err!.response.code).toBe('STATUS_MAPPING_REQUIRED');
    const byField = Object.fromEntries(
      err!.response.details!.map((d) => [d.field, d.suggestedStatusId]),
    );
    expect(byField).toEqual({ 'statusMap.o1': 's1', 'statusMap.o2': 's2' });
    expect(w.prisma.organizationWorkflowScheme.upsert).not.toHaveBeenCalled();
    expect(w.prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(w.invalidate).toHaveBeenCalled(); // cả đường rollback
  });

  it('chạy thật có statusMap: ghi scheme, chuyển việc (version tăng, lịch sử STATUS), cả dự án không ghi đè lẫn dự án có ghi đè riêng được tôn trọng', async () => {
    const w = world({
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    const out = await w.service.setOrganizationScheme(
      'w1',
      'u1',
      { items, statusMap: { o1: 's1', o2: 's2' } },
      false,
    );
    expect(out).toMatchObject({ dryRun: false, totalIssues: 4 });
    expect(w.scheme).toEqual([{ issueTypeId: 'tTask', workflowId: 'wfStd' }]);
    expect(
      w.issues
        .filter((i) => i.projectId === 'p1')
        .map((i) => i.statusId)
        .sort(),
    ).toEqual(['s1', 's2', 's2', 's2']);
    // Dự án có ghi đè giữ nguyên quy trình riêng.
    expect(w.issues.filter((i) => i.projectId === 'p2').every((i) => i.statusId === 'o2')).toBe(
      true,
    );
    const upd = w.prisma.issue.updateMany.mock.calls.map(
      (c) => c[0] as unknown as { data: Record<string, unknown> },
    );
    for (const u of upd)
      expect(u.data).toMatchObject({ updatedById: 'u1', version: { increment: 1 } });
    const history = w.prisma.issueHistory.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(history).toHaveLength(4);
    // Lịch sử do HỆ THỐNG ghi (không phải quản trị viên bấm nút); người sửa việc vẫn là quản trị viên.
    expect(history.every((h) => h.actorId === 'SYS')).toBe(true);
    expect(w.invalidate).toHaveBeenCalled();
  });

  it('M1: chạy thật thêm trạng thái mới còn thiếu vào cột bảng của dự án bị ảnh hưởng (không phải dự án ghi đè)', async () => {
    const w = world({
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    w.prisma.board.findMany.mockImplementation((a: { where: { projectId: string } }) =>
      Promise.resolve(
        a.where.projectId === 'p1'
          ? ([
              {
                id: 'b1',
                columns: [
                  { id: 'c-todo', statuses: [{ statusId: 'o1' }] },
                  { id: 'c-prog', statuses: [{ statusId: 'o2' }] },
                  { id: 'c-done', statuses: [{ statusId: 'o3' }] },
                ],
              },
            ] as never)
          : [],
      ),
    );
    await w.service.setOrganizationScheme(
      'w1',
      'u1',
      { items, statusMap: { o1: 's1', o2: 's2' } },
      false,
    );
    const links = (
      w.prisma.boardColumnStatus.createMany.mock.calls as unknown as Array<
        [{ data: Array<{ columnId: string; statusId: string }> }]
      >
    ).flatMap((c) => c[0].data);
    expect(links).toEqual(
      expect.arrayContaining([
        { columnId: 'c-todo', statusId: 's1' },
        { columnId: 'c-prog', statusId: 's2' },
        { columnId: 'c-done', statusId: 's3' },
      ]),
    );
    // Dự án p2 (ghi đè) không bị đụng tới bảng.
    expect(w.prisma.board.findMany.mock.calls.map((c) => c[0].where.projectId)).not.toContain('p2');
  });

  it('PUT lặp lại cùng cấu hình: không còn gì thay đổi => không chuyển việc, không ghi', async () => {
    const w = world({ scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }] });
    const out = await w.service.setOrganizationScheme('w1', 'u1', { items }, false);
    expect(out).toEqual({
      dryRun: false,
      moves: [],
      totalIssues: 0,
      affectedRules: [],
      nameRefs: [],
    });
    expect(w.prisma.organizationWorkflowScheme.upsert).not.toHaveBeenCalled();
    expect(w.prisma.issue.updateMany).not.toHaveBeenCalled();
  });
});

describe('WorkflowSchemeService.setOrganizationScheme — ánh xạ theo loại, kiểm đầu vào, nameRefs', () => {
  it('statusMapByType thắng statusMap phẳng; đích không thuộc quy trình đích của loại đó coi như chưa chọn', async () => {
    const w = world();
    const out = await w.service.setOrganizationScheme(
      'w1',
      'u1',
      {
        items,
        statusMap: { o1: 'o3', o2: 's3' },
        statusMapByType: { tTask: { o1: 's1', o2: 's2' } },
      },
      true,
    );
    expect(
      sortRows(out.moves)
        .filter((m) => m.projectKey === 'KY')
        .map((m) => [m.fromStatusName, m.toStatusName, m.suggested]),
    ).toEqual([
      ['Cần làm', 'To Do', false],
      ['Đang làm', 'In Progress', false],
    ]);
    const flatOnly = await world().service.setOrganizationScheme(
      'w1',
      'u1',
      { items, statusMap: { o1: 'o3' } },
      true,
    );
    // o1 → o3 (thuộc quy trình cũ, không phải quy trình đích): hệ thống gợi ý lại.
    expect(flatOnly.moves.find((m) => m.fromStatusId === 'o1')).toMatchObject({
      toStatusName: 'To Do',
      suggested: true,
    });
  });

  it('quy trình không chọn được (của dự án / mẫu / tổ chức khác) => 422; loại việc lạ => 404; id trạng thái lạ => 422', async () => {
    const w = world();
    await expect(
      w.service.setOrganizationScheme(
        'w1',
        'u1',
        { items: [{ issueTypeId: 'tTask', workflowId: 'nope' }] },
        true,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      w.service.setOrganizationScheme(
        'w1',
        'u1',
        { items: [{ issueTypeId: 'tX', workflowId: 'wfStd' }] },
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      w.service.setOrganizationScheme('w1', 'u1', { items, statusMap: { o1: 'ghost' } }, true),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('getOrganizationScheme trả các dòng ánh xạ', async () => {
    const w = world({ scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }] });
    expect(await w.service.getOrganizationScheme('w1')).toEqual({
      items: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }],
      issueTypes: [TASK_TYPE],
    });
  });

  it('dryRun và chạy thật đều trả nameRefs: chỉ bộ lọc dùng tên trạng thái cũ không còn (Đang làm), không báo "Done"', async () => {
    const dry = await world().service.setOrganizationScheme('w1', 'u1', { items }, true);
    expect(dry.nameRefs).toEqual([
      {
        kind: 'savedFilter',
        id: 'f1',
        label: 'Đang làm của tôi',
        names: ['Đang làm'],
      },
    ]);
    const real = await world().service.setOrganizationScheme(
      'w1',
      'u1',
      { items, statusMap },
      false,
    );
    expect(real.nameRefs.map((n) => n.id)).toEqual(['f1']);
  });
});

const base = {
  issueTypeId: 'tTask',
  workflowId: 'wfStd',
  statusMap: { o2: 's2' } as Record<string, string>,
};

describe('WorkflowSchemeService.setProjectOverride / clearProjectOverride', () => {
  it('copy=true: chép quy trình thành bản riêng (tên <tên> (<MÃ>)), đổi statusMap nguồn sang trạng thái cùng tên của bản chép, chuyển việc', async () => {
    const w = world();
    const out = await w.service.setProjectOverride(
      'w1',
      'p2',
      'u1',
      { ...base, copy: true },
      false,
    );
    expect(out).toMatchObject({ dryRun: false, totalIssues: 2 });
    expect(w.prisma.workflow.create.mock.calls[0]![0].data).toMatchObject({
      projectId: 'p2',
      name: 'Standard Workflow (TI)',
      isDefault: false,
      isTemplate: false,
    });
    expect(w.prisma.status.create).toHaveBeenCalledTimes(3);
    expect(w.prisma.workflowTransition.create).toHaveBeenCalledTimes(2);
    const copyId = w.overrides[0]!.workflowId;
    expect(copyId).not.toBe('wfStd');
    expect(w.overrides).toEqual([{ projectId: 'p2', issueTypeId: 'tTask', workflowId: copyId }]);
    const copyIn = w.statuses.find((s) => s.workflowId === copyId && s.name === 'In Progress')!;
    expect(
      w.issues.filter((i) => i.projectId === 'p2').every((i) => i.statusId === copyIn.id),
    ).toBe(true);
    // Việc của dự án khác không bị đụng.
    expect(
      w.issues.filter((i) => i.projectId === 'p1').every((i) => ['o1', 'o2'].includes(i.statusId)),
    ).toBe(true);
    expect(w.invalidate).toHaveBeenCalledWith('p2');
  });

  it('copy=true lặp lại (đã có bản chép): dùng lại, không chép thêm, không chuyển việc nữa (idempotent)', async () => {
    const w = world({ existingCopy: true });
    await w.service.setProjectOverride('w1', 'p2', 'u1', { ...base, copy: true }, false);
    expect(w.prisma.workflow.create).not.toHaveBeenCalled();
    expect(w.overrides).toEqual([{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'cp' }]);
    const again = await w.service.setProjectOverride(
      'w1',
      'p2',
      'u1',
      { ...base, copy: true },
      false,
    );
    expect(again).toMatchObject({ moves: [], totalIssues: 0 });
    expect(w.overrides).toHaveLength(1);
  });

  it('dryRun: xem trước theo quy trình nguồn, KHÔNG chép, không ghi override, không chuyển việc', async () => {
    const w = world();
    const out = await w.service.setProjectOverride('w1', 'p2', 'u1', { ...base, copy: true }, true);
    expect(out).toMatchObject({ dryRun: true, totalIssues: 2 });
    expect(out.moves[0]).toMatchObject({
      projectKey: 'TI',
      fromStatusName: 'Đang làm',
      toStatusName: 'In Progress',
      suggested: false,
    });
    expect(w.prisma.workflow.create).not.toHaveBeenCalled();
    expect(w.prisma.projectWorkflowOverride.upsert).not.toHaveBeenCalled();
    expect(w.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('dùng thẳng quy trình tổ chức (copy không bật); thiếu statusMap => 422 STATUS_MAPPING_REQUIRED, chưa ghi override', async () => {
    const w = world();
    const err = await rejects(
      w.service.setProjectOverride(
        'w1',
        'p2',
        'u1',
        { issueTypeId: 'tTask', workflowId: 'wfStd', statusMap: {} },
        false,
      ),
    );
    expect(err!.response.code).toBe('STATUS_MAPPING_REQUIRED');
    expect(w.overrides).toHaveLength(0);
    await w.service.setProjectOverride('w1', 'p2', 'u1', base, false);
    expect(w.overrides[0]!.workflowId).toBe('wfStd');
    expect(w.prisma.workflow.create).not.toHaveBeenCalled();
  });

  it('dự án đã lưu trữ => 422, không ghi gì', async () => {
    const w = world({ archived: true });
    await expect(
      w.service.setProjectOverride('w1', 'p2', 'u1', { ...base, copy: true }, false),
    ).rejects.toMatchObject({ status: 422 });
    expect(w.prisma.projectWorkflowOverride.upsert).not.toHaveBeenCalled();
    expect(w.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('chép quy trình của dự án khác / mẫu bị từ chối (chỉ quy trình chung của tổ chức)', async () => {
    const w = world({ existingCopy: true });
    await expect(
      w.service.setProjectOverride(
        'w1',
        'p1',
        'u1',
        { issueTypeId: 'tTask', workflowId: 'cp', statusMap: {}, copy: true },
        false,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('WorkflowSchemeService.clearProjectOverride / getProjectScheme', () => {
  it('quay về dùng chung (DELETE): chuyển việc sang quy trình tổ chức theo statusMap, xoá ghi đè; lặp lại là no-op', async () => {
    const w = world({
      scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }],
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    const out = await w.service.clearProjectOverride(
      'w1',
      'p2',
      'u1',
      'tTask',
      { o2: 's2' },
      false,
    );
    expect(out).toMatchObject({ dryRun: false, totalIssues: 2 });
    expect(w.overrides).toHaveLength(0);
    expect(w.issues.filter((i) => i.projectId === 'p2').every((i) => i.statusId === 's2')).toBe(
      true,
    );
    const again = await w.service.clearProjectOverride('w1', 'p2', 'u1', 'tTask', {}, false);
    expect(again).toEqual({
      dryRun: false,
      moves: [],
      totalIssues: 0,
      affectedRules: [],
      nameRefs: [],
    });
  });

  it('DELETE thiếu statusMap => 422 và ghi đè còn nguyên; dryRun chỉ xem trước', async () => {
    const w = world({
      scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }],
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    const err = await rejects(w.service.clearProjectOverride('w1', 'p2', 'u1', 'tTask', {}, false));
    expect(err!.response.code).toBe('STATUS_MAPPING_REQUIRED');
    expect(w.overrides).toHaveLength(1);
    const prev = await w.service.clearProjectOverride('w1', 'p2', 'u1', 'tTask', {}, true);
    expect(prev.moves[0]).toMatchObject({ toStatusName: 'In Progress', suggested: true });
    expect(w.overrides).toHaveLength(1);
  });

  it('getProjectScheme: ghi đè → tổ chức → mặc định của dự án', async () => {
    const w = world({
      scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }],
      overrides: [{ projectId: 'p2', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    w.prisma.issueType.findMany.mockResolvedValue([{ id: 'tTask' }, { id: 'tBug' }] as never);
    const p2 = await w.service.getProjectScheme('w1', 'p2');
    expect(p2.items).toEqual([
      {
        issueTypeId: 'tTask',
        workflowId: 'wfOld',
        isOverride: true,
        organizationWorkflowId: 'wfStd',
      },
      { issueTypeId: 'tBug', workflowId: 'wfOld', isOverride: false, organizationWorkflowId: null },
    ]);
    const p1 = await w.service.getProjectScheme('w1', 'p1');
    expect(p1.items[0]).toEqual({
      issueTypeId: 'tTask',
      workflowId: 'wfStd',
      isOverride: false,
      organizationWorkflowId: 'wfStd',
    });
  });
});

// ------------------------------------------------------------------------------------------------
// (M1/L2) Sửa quy tắc automation + khoá advisory + thông báo SAU commit — đường gọi PUT/ghi đè/DELETE
// ------------------------------------------------------------------------------------------------

const RULE = {
  id: 'r1',
  name: 'Khi đang làm',
  createdById: 'u-rule',
  trigger: 'ISSUE_TRANSITIONED',
  triggerConfig: { toStatusId: 'o2' },
  actions: [{ type: 'transition', toStatusId: 'o3' }],
};
const statusMap = { o1: 's1', o2: 's2', o3: 's3' };

describe('WorkflowSchemeService — quy tắc automation, khoá, thông báo', () => {
  it('PUT scheme dryRun: liệt kê affectedRules nhưng KHÔNG sửa quy tắc, không khoá, không báo', async () => {
    const w = world({ rules: [RULE] });
    const out = await w.service.setOrganizationScheme('w1', 'u1', { items }, true);
    expect(out.affectedRules).toEqual([
      expect.objectContaining({ ruleId: 'r1', outcome: 'rewritten', createdById: 'u-rule' }),
    ]);
    expect(w.prisma.automationRule.update).not.toHaveBeenCalled();
    expect(w.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(w.published).toEqual([]);
    expect(w.events.emit).not.toHaveBeenCalled();
  });

  it('PUT scheme thật: khoá advisory lấy TRƯỚC khi đọc kế hoạch; quy tắc đổi sang id mới; bỏ cache quy tắc sau commit', async () => {
    const w = world({ rules: [RULE] });
    const order: string[] = [];
    w.prisma.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve(0);
    });
    const realGroupBy = w.prisma.issue.groupBy.getMockImplementation()!;
    w.prisma.issue.groupBy.mockImplementationOnce((a) => {
      order.push('plan');
      return realGroupBy(a);
    });
    const out = await w.service.setOrganizationScheme('w1', 'u1', { items, statusMap }, false);
    expect(order[0]).toBe('lock');
    const rule = w.rules[0]!;
    expect(rule.triggerConfig).toEqual({ toStatusId: 's2' });
    expect(rule.actions).toEqual([{ type: 'transition', toStatusId: 's3' }]);
    expect(out.affectedRules).toHaveLength(1);
    expect(w.events.emit).toHaveBeenCalledWith('automation.rules_changed', {
      organizationId: 'w1',
    });
    expect(w.published).toEqual([]); // sửa được hết → không có quy tắc bị tắt, không ai cần báo
  });

  it('chạy thật bị rollback (thiếu statusMap): không sửa quy tắc, không bỏ cache, không báo ai', async () => {
    const w = world({ rules: [RULE] });
    await rejects(w.service.setOrganizationScheme('w1', 'u1', { items }, false));
    expect(w.prisma.automationRule.update).not.toHaveBeenCalled();
    expect(w.events.emit).not.toHaveBeenCalled();
    expect(w.published).toEqual([]);
  });

  it('ghi đè dự án thật: khoá + sửa quy tắc; DELETE ghi đè: khoá + sửa quy tắc; dryRun hai đường chỉ liệt kê', async () => {
    const a = world({ rules: [RULE], scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }] });
    const preview = await a.service.setProjectOverride(
      'w1',
      'p1',
      'u1',
      { issueTypeId: 'tTask', workflowId: 'wfOld', statusMap: {} },
      true,
    );
    expect(preview.dryRun).toBe(true);
    expect(a.prisma.automationRule.update).not.toHaveBeenCalled();
    expect(a.prisma.$executeRaw).not.toHaveBeenCalled();

    const b = world({
      rules: [{ ...RULE, triggerConfig: { toStatusId: 'o2' } }],
      scheme: [{ issueTypeId: 'tTask', workflowId: 'wfStd' }],
      overrides: [{ projectId: 'p1', issueTypeId: 'tTask', workflowId: 'wfOld' }],
    });
    const out = await b.service.setProjectOverride(
      'w1',
      'p1',
      'u1',
      { issueTypeId: 'tTask', workflowId: null, statusMap },
      false,
    );
    expect(b.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(out.affectedRules.map((r) => r.ruleId)).toEqual(['r1']);
    // Còn việc ở trạng thái cũ ở dự án khác (p2 vẫn ở quy trình cũ) thì quy tắc giữ cả id cũ lẫn mới.
    expect(b.events.emit).toHaveBeenCalledWith('automation.rules_changed', {
      organizationId: 'w1',
    });
  });
});
