import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { GoalsService } from './goals.service';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };
/** KrMeasureService giả: không KR tự đo nào được đo (mặc định cho test không liên quan tới L25). */
const NO_MEASURE = { measure: vi.fn(() => Promise.resolve(new Map())) };
/** RbacService giả: người xem có mọi quyền (GOAL_MANAGE…). */
const RBAC = {
  getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(['goal:manage', 'workspace:view']))),
};
/** KrSnapshotCron giả: không chụp gì. */
const NO_SNAPSHOT = { snapshotKeyResult: vi.fn(() => Promise.resolve()) };

type IssueWhere = { where: Record<string, unknown> };
const LIVE = { deletedAt: null };

describe('GoalsService — không đếm/gắn issue của dự án xoá mềm', () => {
  it('validateIssues: where có project.deletedAt:null (không gắn được issue của dự án đã xoá)', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }]));
    const service = new GoalsService(
      { issue: { findMany } } as never,
      ACCESS_ALL as never,
      NO_MEASURE as never,
      NO_SNAPSHOT as never,
      RBAC as never,
    );
    const validate = (
      service as unknown as {
        validateIssues(w: string, ids: string[], p: string | null): Promise<string[]>;
      }
    ).validateIssues.bind(service);
    await expect(validate('w1', ['i1'], null)).resolves.toEqual(['i1']);
    const { where } = (findMany.mock.calls[0] as unknown as [IssueWhere])[0];
    expect(where).toMatchObject({ workspaceId: 'w1', deletedAt: null, project: LIVE });
    // Có projectId của mục tiêu: điều kiện dự án sống vẫn còn, projectId được thêm vào.
    await validate('w1', ['i1'], 'p1');
    const w2 = (findMany.mock.calls[1] as unknown as [IssueWhere])[0].where;
    expect(w2).toMatchObject({ projectId: 'p1', project: LIVE });
  });

  it('list: issue gắn kèm lọc cả issue xoá mềm lẫn dự án xoá mềm', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new GoalsService(
      { objective: { findMany } } as never,
      ACCESS_ALL as never,
      NO_MEASURE as never,
      NO_SNAPSHOT as never,
      RBAC as never,
    );
    await service.list('w1', {}, 'u0');
    const { select } = (
      findMany.mock.calls[0] as unknown as [{ select: { issues: { where: unknown } } }]
    )[0];
    expect(select.issues.where).toEqual({ issue: { deletedAt: null, project: LIVE } });
  });
});

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

/** Dự án `archived` quyết định: mục tiêu gắn dự án đó là chỉ đọc; mục tiêu cả workspace (project null) thì không. */
function setup(archived: boolean, objectiveProject = true) {
  const archivedAt = archived ? new Date() : null;
  const prisma = {
    objective: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'o1',
          projectId: objectiveProject ? 'p1' : null,
          project: objectiveProject ? { archivedAt } : null,
        }),
      ),
      create: vi.fn(() => Promise.resolve({ id: 'o2' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    project: { findFirst: vi.fn(() => Promise.resolve({ id: 'p1', archivedAt })) },
    keyResult: {
      create: vi.fn(() => Promise.resolve({})),
      findFirst: vi.fn(() => Promise.resolve({ id: 'k1' })),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    objectiveIssue: {
      createMany: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({})),
    },
    issue: { findMany: vi.fn(() => Promise.resolve([{ id: 'i1' }])) },
    workspaceMembership: { findFirst: vi.fn(() => Promise.resolve({ userId: 'u1' })) },
    $transaction: vi.fn(() => Promise.resolve([])),
  };
  return {
    service: new GoalsService(
      prisma as never,
      ACCESS_ALL as never,
      NO_MEASURE as never,
      NO_SNAPSHOT as never,
      RBAC as never,
    ),
    prisma,
  };
}

describe('GoalsService — dự án lưu trữ là chỉ đọc', () => {
  it('create gắn vào dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(
      service.create('w1', { name: 'O', period: '2026-Q4', projectId: 'p1' }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it('update chuyển mục tiêu sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setup(true, false);
    await expect(service.update('w1', 'o1', { projectId: 'p1' }, 'u0')).rejects.toMatchObject(
      ARCHIVED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update/remove/KR/issue của mục tiêu thuộc dự án đã lưu trữ => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.update('w1', 'o1', { name: 'Mới' }, 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.remove('w1', 'o1', 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.addKeyResult('w1', 'o1', { name: 'KR', targetValue: 10 }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u0'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeKeyResult('w1', 'o1', 'k1', 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.addIssues('w1', 'o1', ['i1'], 'u0')).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeIssues('w1', 'o1', ['i1'], 'u0')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.objective.delete).not.toHaveBeenCalled();
    expect(prisma.keyResult.create).not.toHaveBeenCalled();
    expect(prisma.keyResult.update).not.toHaveBeenCalled();
    expect(prisma.keyResult.deleteMany).not.toHaveBeenCalled();
    expect(prisma.objectiveIssue.createMany).not.toHaveBeenCalled();
    expect(prisma.objectiveIssue.deleteMany).not.toHaveBeenCalled();
  });

  it('mục tiêu cả workspace (không gắn dự án) vẫn xoá được', async () => {
    const { service, prisma } = setup(true, false);
    await service.remove('w1', 'o1', 'u0');
    expect(prisma.objective.delete).toHaveBeenCalled();
  });
});

describe('GoalsService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const scope = { OR: [{ projectId: null }, { project: visible }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  function make() {
    const prisma = {
      objective: {
        findMany: vi.fn((_a?: unknown) => Promise.resolve([])),
        findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)),
        create: vi.fn(() => Promise.resolve({ id: 'o2' })),
      },
      project: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)) },
      issue: { findMany: vi.fn((_a?: unknown) => Promise.resolve([])) },
    };
    const access = { visibleWhere: vi.fn(() => Promise.resolve(visible)) };
    return {
      service: new GoalsService(
        prisma as never,
        access as never,
        NO_MEASURE as never,
        NO_SNAPSHOT as never,
        RBAC as never,
      ),
      prisma,
      access,
    };
  }

  it('list(w, f, viewer): mục tiêu cấp workspace luôn hiện, gắn dự án chỉ khi thấy; việc gắn kèm của dự án ẩn bị bỏ', async () => {
    const { service, prisma, access } = make();
    await service.list('w1', { period: '2026-Q4' }, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(whereOf(prisma.objective.findMany)).toMatchObject({
      workspaceId: 'w1',
      period: '2026-Q4',
      ...scope,
    });
    const { select } = (
      prisma.objective.findMany.mock.calls[0] as unknown as [
        { select: { issues: { where: unknown } } },
      ]
    )[0];
    expect(select.issues.where).toEqual({
      issue: { deletedAt: null, project: { deletedAt: null, ...visible } },
    });
  });

  it('periods(w, viewer): chỉ kỳ của mục tiêu người xem thấy', async () => {
    const { service, prisma } = make();
    await service.periods('w1', 'u1');
    expect(whereOf(prisma.objective.findMany)).toMatchObject({ workspaceId: 'w1', ...scope });
  });

  it('get(w, id, viewer): mục tiêu của dự án riêng tư không thấy → 404 "Mục tiêu" như không tồn tại', async () => {
    const { service, prisma } = make();
    await expect(service.get('w1', 'o1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.objective.findFirst)).toMatchObject({ id: 'o1', ...scope });
  });

  it('thao tác ghi (update/remove/KR/issue) cũng 404 khi mục tiêu thuộc dự án ẩn', async () => {
    const { service, prisma } = make();
    await expect(service.update('w1', 'o1', { name: 'x' }, 'u1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove('w1', 'o1', 'u1')).rejects.toMatchObject({ status: 404 });
    await expect(
      service.addKeyResult('w1', 'o1', { name: 'KR', targetValue: 1 }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.addIssues('w1', 'o1', ['i1'], 'u1')).rejects.toMatchObject({
      status: 404,
    });
    for (let i = 0; i < 4; i++)
      expect(whereOf(prisma.objective.findFirst, i)).toMatchObject({ id: 'o1', ...scope });
  });

  it('create gắn vào dự án riêng tư không thấy → 404 "Dự án"; không tạo', async () => {
    const { service, prisma } = make();
    await expect(
      service.create('w1', { name: 'O', period: '2026-Q4', projectId: 'hr' }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.project.findFirst)).toMatchObject({ id: 'hr', ...visible });
    expect(prisma.objective.create).not.toHaveBeenCalled();
  });

  it('gắn việc: chỉ nhận việc của dự án người xem thấy (việc ở dự án ẩn bị từ chối như việc không tồn tại)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    await expect(service.addIssues('w1', 'o1', ['i-hidden'], 'u1')).rejects.toMatchObject({
      status: 403,
    });
    expect(whereOf(prisma.issue.findMany)).toMatchObject({
      id: { in: ['i-hidden'] },
      project: { deletedAt: null, ...visible },
    });
  });

  it('update(issueIds): chỉ thay phần việc thuộc dự án người sửa thấy, KHÔNG xoá liên kết tới việc của dự án ẩn (I1)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    prisma.issue.findMany.mockResolvedValue([{ id: 'i1' }] as never);
    const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 0 }));
    const createMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 1 }));
    Object.assign(prisma, {
      objectiveIssue: { deleteMany, createMany },
      keyResult: { findMany: vi.fn(() => Promise.resolve([])) },
      $transaction: vi.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
    });
    (prisma.objective as Record<string, unknown>).update = vi.fn(() => Promise.resolve({}));
    await expect(service.update('w1', 'o1', { issueIds: ['i1'] }, 'u1')).rejects.toBeDefined(); // get() sau ghi: mock trả null → 404
    expect(whereOf(deleteMany)).toEqual({ objectiveId: 'o1', issue: { project: visible } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ objectiveId: 'o1', issueId: 'i1' }] });
  });

  it('removeIssues: chỉ gỡ việc thuộc dự án người gọi thấy (không dò/gỡ liên kết tới việc dự án ẩn)', async () => {
    const { service, prisma } = make();
    prisma.objective.findFirst.mockResolvedValue({
      id: 'o1',
      projectId: null,
      project: null,
    } as never);
    const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 0 }));
    Object.assign(prisma, { objectiveIssue: { deleteMany } });
    await expect(service.removeIssues('w1', 'o1', ['i-hidden'], 'u1')).rejects.toBeDefined(); // read() sau ghi: mock trả null → 404
    expect(whereOf(deleteMany)).toEqual({
      objectiveId: 'o1',
      issueId: { in: ['i-hidden'] },
      issue: { project: visible },
    });
  });
});

describe('GoalsService — KR tự đo (L25)', () => {
  const objectiveRow = (krs: unknown[]) => ({
    id: 'o1',
    workspaceId: 'w1',
    projectId: null,
    name: 'O',
    description: null,
    period: '2026-Q4',
    status: 'ACTIVE',
    ownerId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    owner: null,
    project: null,
    keyResults: krs,
    issues: [],
  });
  const krRow = (over: Record<string, unknown>) => ({
    id: 'k1',
    name: 'Bug mở',
    unit: 'NUMBER',
    startValue: 20,
    targetValue: 0,
    currentValue: 3,
    source: 'OPEN_BUGS',
    sourceConfig: {},
    unitLabel: null,
    _count: { checkIns: 0 },
    checkIns: [],
    ...over,
  });

  function make(rows: unknown[], measured: Map<string, unknown>) {
    const prisma = {
      objective: { findFirst: vi.fn(() => Promise.resolve(objectiveRow(rows))) },
    };
    const measure = { measure: vi.fn((..._a: unknown[]) => Promise.resolve(measured)) };
    return {
      service: new GoalsService(
        prisma as never,
        ACCESS_ALL as never,
        measure as never,
        NO_SNAPSHOT as never,
        RBAC as never,
      ),
      measure,
    };
  }

  it('get(): KR OPEN_BUGS trả currentValue = số đo (12) dù DB có 3, progress tính theo 12', async () => {
    const measured = new Map([
      ['k1', { value: 12, measuredAt: '2026-10-16T01:00:00.000Z', error: null }],
    ]);
    const { service, measure } = make([krRow({})], measured);
    const goal = await service.get('w1', 'o1', 'u1');
    expect(measure.measure).toHaveBeenCalledWith('w1', { viewerId: 'u1' }, [
      expect.objectContaining({ id: 'k1', source: 'OPEN_BUGS' }),
    ]);
    expect(goal.keyResults[0]).toMatchObject({
      currentValue: 12,
      source: 'OPEN_BUGS',
      measuredAt: '2026-10-16T01:00:00.000Z',
      measureError: null,
      progress: 40, // (12-20)/(0-20)
    });
    expect(goal.progress).toBe(40);
  });

  it('đo lỗi (JQL sai): giữ currentValue cũ và trả measureError', async () => {
    const measured = new Map([
      ['k1', { value: null, measuredAt: '2026-10-16T01:00:00.000Z', error: 'JQL không hợp lệ' }],
    ]);
    const { service } = make([krRow({ source: 'ISSUE_COUNT_JQL' })], measured);
    const goal = await service.get('w1', 'o1', 'u1');
    expect(goal.keyResults[0]).toMatchObject({
      currentValue: 3,
      measureError: 'JQL không hợp lệ',
    });
  });

  it('KR MANUAL không đổi: không gọi bộ đo, measuredAt/measureError = null', async () => {
    const { service, measure } = make(
      [krRow({ source: 'MANUAL', sourceConfig: null, currentValue: 5 })],
      new Map(),
    );
    const goal = await service.get('w1', 'o1', 'u1');
    expect(measure.measure).not.toHaveBeenCalled();
    expect(goal.keyResults[0]).toMatchObject({
      currentValue: 5,
      source: 'MANUAL',
      measuredAt: null,
      measureError: null,
      progress: 75,
    });
  });
});

describe('GoalsService — ghi KR tự đo (L25)', () => {
  function make(
    existing: { source: string; sourceConfig: unknown } = { source: 'MANUAL', sourceConfig: null },
  ) {
    const prisma = {
      objective: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'o1', projectId: null, project: null })),
      },
      keyResult: {
        create: vi.fn((_a?: unknown) => Promise.resolve({})),
        update: vi.fn((_a?: unknown) => Promise.resolve({})),
        findFirst: vi.fn(() => Promise.resolve({ id: 'k1', currentValue: 1, ...existing })),
      },
      keyResultCheckIn: { create: vi.fn((_a?: unknown) => Promise.resolve({})) },
      $transaction: vi.fn(() => Promise.resolve([])),
    };
    const measure = {
      measure: vi.fn(() => Promise.resolve(new Map())),
      validateConfig: vi.fn((..._a: unknown[]) => Promise.resolve()),
    };
    const service = new GoalsService(
      prisma as never,
      ACCESS_ALL as never,
      measure as never,
      NO_SNAPSHOT as never,
      RBAC as never,
    );
    // đọc lại sau ghi: không phải đối tượng kiểm của test này
    (service as unknown as { read: () => Promise<unknown> }).read = () => Promise.resolve({});
    return { service, prisma, measure };
  }

  it('addKeyResult tự đo: kiểm cấu hình, lưu source/sourceConfig, bỏ qua currentValue gửi lên', async () => {
    const { service, prisma, measure } = make();
    await service.addKeyResult(
      'w1',
      'o1',
      {
        name: 'Bug mở',
        startValue: 6,
        targetValue: 0,
        currentValue: 99,
        source: 'OPEN_BUGS',
        sourceConfig: { projectId: 'p1', junk: 1 },
      },
      'u1',
    );
    expect(measure.validateConfig).toHaveBeenCalledWith('w1', 'u1', 'OPEN_BUGS', {
      projectId: 'p1',
    });
    expect(prisma.keyResult.create.mock.calls[0]![0]).toMatchObject({
      data: {
        source: 'OPEN_BUGS',
        sourceConfig: { projectId: 'p1' },
        currentValue: 6,
      },
    });
  });

  it('addKeyResult: cấu hình sai (JQL bị từ chối) → lỗi, không tạo', async () => {
    const { service, prisma, measure } = make();
    measure.validateConfig.mockRejectedValueOnce(new Error('JQL không hợp lệ'));
    await expect(
      service.addKeyResult(
        'w1',
        'o1',
        { name: 'x', targetValue: 1, source: 'ISSUE_COUNT_JQL', sourceConfig: { jql: 'zzz' } },
        'u1',
      ),
    ).rejects.toThrow('JQL không hợp lệ');
    expect(prisma.keyResult.create).not.toHaveBeenCalled();
  });

  it('addKeyResult: thiếu cấu hình theo nguồn → 422 từ service (đường không qua pipe)', async () => {
    const { service } = make();
    await expect(
      service.addKeyResult(
        'w1',
        'o1',
        { name: 'x', targetValue: 1, source: 'SPRINT_COMPLETION' },
        'u1',
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('updateKeyResult: KR đang tự đo bỏ qua currentValue; KR nhập tay vẫn ghi', async () => {
    const auto = make({ source: 'OPEN_BUGS', sourceConfig: {} });
    await auto.service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u1');
    expect(
      (auto.prisma.keyResult.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data,
    ).not.toHaveProperty('currentValue');

    const manual = make();
    await manual.service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u1');
    // KR nhập tay: số đổi đi qua transaction check-in (không `update` trần); KR tự đo thì không.
    expect(manual.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auto.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Prisma giả có trạng thái cho KR (currentValue) + transaction tương tác: `updateMany` có điều kiện `currentValue`
 * như Postgres thật (khớp mới đổi, count 0 nếu người khác đã đổi).
 */
function makeKrPrisma(
  kr: { id: string; source: string; currentValue: number; sourceConfig?: unknown } | null,
  objective: Record<string, unknown> = {
    id: 'o1',
    projectId: null,
    project: { archivedAt: null },
  },
) {
  const state = kr ? { ...kr } : null;
  const prisma = {
    objective: { findFirst: vi.fn(() => Promise.resolve(objective)) },
    keyResult: {
      findFirst: vi.fn((_a?: unknown) => Promise.resolve(state && { ...state })),
      update: vi.fn((_a?: unknown) => Promise.resolve({})),
      updateMany: vi.fn(
        (a: { where: { currentValue?: number }; data: Record<string, unknown> }) => {
          if (
            !state ||
            (a.where.currentValue !== undefined && a.where.currentValue !== state.currentValue)
          )
            return Promise.resolve({ count: 0 });
          Object.assign(state, a.data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    keyResultCheckIn: {
      create: vi.fn((_a?: unknown) => Promise.resolve({})),
      findMany: vi.fn((_a?: unknown) => Promise.resolve([])),
    },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
  };
  return { prisma, state };
}

function makeKrService(prisma: unknown) {
  const service = new GoalsService(
    prisma as never,
    ACCESS_ALL as never,
    NO_MEASURE as never,
    NO_SNAPSHOT as never,
    RBAC as never,
  );
  (service as unknown as { read: () => Promise<unknown> }).read = () => Promise.resolve({ ok: 1 });
  return service;
}

describe('GoalsService — check-in Key Result (L26) + OCC (I3)', () => {
  function make(
    kr: Parameters<typeof makeKrPrisma>[0] = { id: 'k1', source: 'MANUAL', currentValue: 6 },
  ) {
    const { prisma, state } = makeKrPrisma(kr);
    return { service: makeKrService(prisma), prisma, state };
  }

  it('addCheckIn: đọc LẠI trong transaction; ghi lịch sử previousValue = số cũ + cập nhật có điều kiện currentValue', async () => {
    const { service, prisma, state } = make();
    await service.addCheckIn('w1', 'o1', 'k1', { value: 4, note: 'Đã vá 2 bug lớn' }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.keyResult.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', currentValue: 6 },
      data: { currentValue: 4 },
    });
    expect(prisma.keyResultCheckIn.create).toHaveBeenCalledWith({
      data: {
        keyResultId: 'k1',
        value: 4,
        previousValue: 6,
        note: 'Đã vá 2 bug lớn',
        authorId: 'u1',
      },
    });
    expect(state!.currentValue).toBe(4);
  });

  it('addCheckIn: expectedValue lệch số trong DB (người khác vừa check-in) → 409 có thông báo rõ, không ghi', async () => {
    const { service, prisma } = make({ id: 'k1', source: 'MANUAL', currentValue: 4 });
    await expect(
      service.addCheckIn('w1', 'o1', 'k1', { value: 3, expectedValue: 6 }, 'u1'),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('người khác') as unknown,
    });
    expect(prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    // khớp expectedValue thì ghi bình thường
    await service.addCheckIn('w1', 'o1', 'k1', { value: 3, expectedValue: 4 }, 'u1');
    expect(prisma.keyResultCheckIn.create).toHaveBeenCalledTimes(1);
  });

  it('addCheckIn: người khác chen vào giữa lúc đọc và ghi (updateMany count 0) → 409, previousValue không bao giờ sai', async () => {
    const { service, prisma, state } = make();
    prisma.keyResult.findFirst.mockImplementationOnce(() => {
      const seen = { ...state! };
      state!.currentValue = 5; // check-in đồng thời xen vào sau khi ta đọc 6
      return Promise.resolve(seen);
    });
    await expect(service.addCheckIn('w1', 'o1', 'k1', { value: 4 }, 'u1')).rejects.toMatchObject({
      status: 409,
    });
    expect(prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    expect(state!.currentValue).toBe(5);
  });

  it('addCheckIn: KR tự đo (source != MANUAL) → 422, không ghi', async () => {
    const { service, prisma } = make({ id: 'k1', source: 'OPEN_BUGS', currentValue: 3 });
    await expect(service.addCheckIn('w1', 'o1', 'k1', { value: 4 }, 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('tự đo') as unknown,
    });
    expect(prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    expect(prisma.keyResult.updateMany).not.toHaveBeenCalled();
  });

  it('addCheckIn: KR không thuộc mục tiêu → 404; dự án lưu trữ → 422 (qua requireObjective)', async () => {
    const missing = make(null);
    await expect(
      missing.service.addCheckIn('w1', 'o1', 'kx', { value: 1 }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    const arch = make();
    arch.prisma.objective.findFirst.mockResolvedValueOnce({
      id: 'o1',
      projectId: 'p1',
      project: { archivedAt: new Date() },
    });
    await expect(
      arch.service.addCheckIn('w1', 'o1', 'k1', { value: 1 }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(arch.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
  });

  it('updateKeyResult(currentValue) trên KR nhập tay đi qua cùng đường check-in (ghi lịch sử, ghi chú trống)', async () => {
    const { service, prisma } = make();
    await service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.keyResultCheckIn.create).toHaveBeenCalledWith({
      data: { keyResultId: 'k1', value: 5, previousValue: 6, note: null, authorId: 'u1' },
    });
    expect(prisma.keyResult.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', currentValue: 6 },
      data: { currentValue: 5 },
    });
  });

  it('updateKeyResult: expectedCurrentValue lệch → 409; chỉ đổi tên/nhãn hoặc currentValue không đổi → không ghi check-in', async () => {
    const { service, prisma } = make();
    await expect(
      service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5, expectedCurrentValue: 9 }, 'u1'),
    ).rejects.toMatchObject({ status: 409 });
    await service.updateKeyResult('w1', 'o1', 'k1', { name: 'Mới', unitLabel: ' bug ' }, 'u1');
    await service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 6 }, 'u1');
    expect(prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    expect(prisma.keyResult.update).toHaveBeenCalledTimes(2);
  });

  it('listCheckIns: sắp createdAt giảm dần, mặc định 30, kẹp tối đa 50, trả tác giả gọn', async () => {
    const { service, prisma } = make();
    await service.listCheckIns('w1', 'o1', 'k1', undefined, 'u1');
    await service.listCheckIns('w1', 'o1', 'k1', 999, 'u1');
    await service.listCheckIns('w1', 'o1', 'k1', 0, 'u1');
    const args = prisma.keyResultCheckIn.findMany.mock.calls.map(
      (c) => c[0] as { where: unknown; orderBy: unknown; take: number },
    );
    expect(args.map((a) => a.take)).toEqual([30, 50, 1]);
    expect(args[0]!.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args[0]!.where).toEqual({ keyResultId: 'k1', source: 'MANUAL' });
  });

  it('listCheckIns: KR của mục tiêu không thấy/không có → 404', async () => {
    const { service } = make(null);
    await expect(service.listCheckIns('w1', 'o1', 'k1', 10, 'u1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

const TODAY = new Date('2026-10-16T05:00:00Z');
type Row = {
  keyResultId: string;
  value: number;
  createdAt: Date;
  snapshotDate: Date | null;
  source: 'AUTO' | 'MANUAL';
};

const row = (
  keyResultId: string,
  day: string,
  value: number,
  source: Row['source'] = 'AUTO',
): Row => ({
  keyResultId,
  value,
  source,
  snapshotDate: source === 'AUTO' ? new Date(`${day}T00:00:00Z`) : null,
  createdAt: new Date(`${day}T0${source === 'AUTO' ? 1 : 9}:30:00Z`),
});

function make(opts: {
  period?: string;
  projectId?: string | null;
  krs: Array<Record<string, unknown>>;
  rows: Row[];
  canSee?: (projectId: string) => boolean;
}) {
  const prisma = {
    objective: {
      findFirst: vi.fn((_a?: unknown) =>
        Promise.resolve({
          id: 'o1',
          period: opts.period ?? '2026-Q4',
          projectId: opts.projectId ?? null,
          keyResults: opts.krs,
        }),
      ),
    },
    keyResultCheckIn: {
      findMany: vi.fn((_a?: unknown) => Promise.resolve(opts.rows)),
    },
  };
  const access = {
    visibleWhere: vi.fn(() => Promise.resolve({})),
    canSee: vi.fn((_u: string, _w: string, p: string) => Promise.resolve(opts.canSee?.(p) ?? true)),
  };
  const service = new GoalsService(
    prisma as never,
    access as never,
    NO_MEASURE as never,
    NO_SNAPSHOT as never,
    RBAC as never,
  );
  return { service, prisma, access };
}

const kr = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `KR ${id}`,
  unit: 'NUMBER',
  unitLabel: 'bug',
  startValue: 6,
  targetValue: 0,
  source: 'MANUAL',
  sourceConfig: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('GoalsService.progressHistory (L29)', () => {
  it('điền bù ngày thiếu bằng giá trị trước đó (bước thang) tới hôm nay; KR đo ngược 6→0, value 3 = 50%', async () => {
    const { service } = make({
      krs: [kr('k1')],
      rows: [row('k1', '2026-10-13', 6), row('k1', '2026-10-15', 3)],
    });
    const h = await service.progressHistory('w1', 'o1', 'u1', 4, TODAY);
    expect(h.from).toBe('2026-10-13');
    expect(h.to).toBe('2026-10-16');
    expect(h.keyResults[0]!.points.map((p) => [p.date, p.value, p.progress])).toEqual([
      ['2026-10-13', 6, 0],
      ['2026-10-14', 6, 0],
      ['2026-10-15', 3, 50],
      ['2026-10-16', 3, 50],
    ]);
  });

  it('không tạo điểm trước dòng dữ liệu đầu của KR; objective = trung bình các KR đã có điểm tại ngày đó', async () => {
    const { service } = make({
      krs: [kr('k1'), kr('k2', { startValue: 0, targetValue: 10 })],
      rows: [
        row('k1', '2026-10-14', 3), // 50
        row('k2', '2026-10-15', 10), // 100
      ],
    });
    const h = await service.progressHistory('w1', 'o1', 'u1', 3, TODAY);
    expect(h.keyResults[1]!.points[0]!.date).toBe('2026-10-15');
    expect(h.objective).toEqual([
      { date: '2026-10-14', progress: 50 },
      { date: '2026-10-15', progress: 75 },
      { date: '2026-10-16', progress: 75 },
    ]);
  });

  it('check-in tay cùng ngày với bản chụp thắng (muộn hơn); auto = true cho điểm từ bản chụp', async () => {
    const { service } = make({
      krs: [kr('k1')],
      rows: [row('k1', '2026-10-15', 5, 'AUTO'), row('k1', '2026-10-15', 4, 'MANUAL')],
    });
    const h = await service.progressHistory('w1', 'o1', 'u1', 2, TODAY);
    const p = h.keyResults[0]!.points.find((x) => x.date === '2026-10-15')!;
    expect(p.value).toBe(4);
    expect(p.auto).toBe(false);
  });
});

describe('GoalsService.progressHistory — phạm vi xem, kỳ vọng, giới hạn (L29)', () => {
  it('KR có projectId mà người xem không thấy → points [] + scopeNote; không truy vấn lịch sử của nó', async () => {
    const { service, prisma } = make({
      krs: [kr('k1', { source: 'OPEN_BUGS', sourceConfig: { projectId: 'hr' } }), kr('k2')],
      rows: [row('k2', '2026-10-16', 3)],
      canSee: (p) => p !== 'hr',
    });
    const h = await service.progressHistory('w1', 'o1', 'u1', 2, TODAY);
    expect(h.keyResults[0]).toMatchObject({
      id: 'k1',
      points: [],
      scopeNote: 'Dự án riêng tư — bạn không có quyền xem lịch sử',
    });
    expect(h.keyResults[1]!.scopeNote).toBeNull();
    const where = (
      prisma.keyResultCheckIn.findMany.mock.calls[0]![0] as {
        where: { keyResultId: { in: string[] } };
      }
    ).where;
    expect(where.keyResultId.in).toEqual(['k2']);
    // objective chỉ tính KR người xem thấy
    expect(h.objective.every((o) => o.progress === 50)).toBe(true);
  });

  it('expected: kỳ quý có mốc theo thời gian, kỳ tự do → null', async () => {
    const q = await make({
      krs: [kr('k1')],
      rows: [row('k1', '2026-10-15', 3)],
    }).service.progressHistory('w1', 'o1', 'u1', 2, TODAY);
    expect(q.period).toBe('2026-Q4');
    // Từ đầu cửa sổ tới HẾT QUÝ (đường KR dừng ở hôm nay, mốc kỳ vọng đi tiếp tới 100%).
    expect(q.expected![0]!.date).toBe('2026-10-15');
    expect(q.expected!.at(-1)).toEqual({ date: '2026-12-31', progress: 100 });
    expect(q.expected![1]!.progress).toBeGreaterThan(q.expected![0]!.progress);
    const free = await make({
      period: 'Sprint 5',
      krs: [kr('k1')],
      rows: [],
    }).service.progressHistory('w1', 'o1', 'u1', 2, TODAY);
    expect(free.expected).toBeNull();
  });

  it('days > 365 bị kẹp 365; truy vấn một findMany có orderBy + take ≤ 365 × số KR', async () => {
    const { service, prisma } = make({ krs: [kr('k1'), kr('k2')], rows: [] });
    const h = await service.progressHistory('w1', 'o1', 'u1', 9999, TODAY);
    expect(h.from).toBe('2025-10-17'); // 365 ngày gồm hôm nay
    expect(prisma.keyResultCheckIn.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.keyResultCheckIn.findMany.mock.calls[0]![0] as {
      orderBy: unknown;
      take: number;
    };
    expect(arg.take).toBe(365 * 2);
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('mục tiêu người xem không thấy → 404 (cùng điều kiện phạm vi)', async () => {
    const { service, prisma } = make({ krs: [], rows: [] });
    prisma.objective.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.progressHistory('w1', 'o1', 'u1', 30, TODAY)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('GoalsService — chụp ngay khi KR đổi sang tự đo (L29)', () => {
  it('addKeyResult tự đo → snapshotKeyResult sau khi ghi; KR nhập tay → không chụp; lỗi chụp không làm hỏng yêu cầu', async () => {
    const snapshots = { snapshotKeyResult: vi.fn((..._a: unknown[]) => Promise.resolve()) };
    const prisma = {
      objective: {
        findFirst: vi.fn(() => Promise.resolve({ id: 'o1', projectId: null, project: null })),
      },
      keyResult: { create: vi.fn(() => Promise.resolve({ id: 'knew' })) },
    };
    const measure = {
      measure: vi.fn(() => Promise.resolve(new Map())),
      validateConfig: vi.fn(() => Promise.resolve()),
    };
    const service = new GoalsService(
      prisma as never,
      ACCESS_ALL as never,
      measure as never,
      snapshots as never,
      RBAC as never,
    );
    (service as unknown as { read: () => Promise<unknown> }).read = () => Promise.resolve({});
    await service.addKeyResult(
      'w1',
      'o1',
      { name: 'Bug', targetValue: 0, source: 'OPEN_BUGS', sourceConfig: {} },
      'u1',
    );
    expect(snapshots.snapshotKeyResult).toHaveBeenCalledWith('knew');
    snapshots.snapshotKeyResult.mockClear();
    await service.addKeyResult('w1', 'o1', { name: 'Tay', targetValue: 5 }, 'u1');
    expect(snapshots.snapshotKeyResult).not.toHaveBeenCalled();
    snapshots.snapshotKeyResult.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.addKeyResult(
        'w1',
        'o1',
        { name: 'Bug2', targetValue: 0, source: 'OPEN_BUGS', sourceConfig: {} },
        'u1',
      ),
    ).resolves.toBeDefined();
  });
});

type Existing = {
  id: string;
  source: string;
  sourceConfig: unknown;
  currentValue: number;
};

function makeFormSvc(existing: Existing[]) {
  const prisma = {
    objective: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'o1', projectId: null, project: null })),
      update: vi.fn((_a?: unknown) => Promise.resolve({})),
    },
    keyResult: {
      findMany: vi.fn((_a?: unknown) => Promise.resolve(existing)),
      update: vi.fn((_a?: unknown) => Promise.resolve({})),
      create: vi.fn((_a?: unknown) => Promise.resolve({})),
      deleteMany: vi.fn((_a?: unknown) => Promise.resolve({ count: 0 })),
      updateMany: vi.fn((a: { where: { id: string; currentValue: number } }) =>
        Promise.resolve({
          count:
            existing.find((e) => e.id === a.where.id)?.currentValue === a.where.currentValue
              ? 1
              : 0,
        }),
      ),
    },
    keyResultCheckIn: { create: vi.fn((_a?: unknown) => Promise.resolve({})) },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => Promise.resolve(cb(prisma))),
  };
  const measure = {
    measure: vi.fn(() => Promise.resolve(new Map())),
    validateConfig: vi.fn((..._a: unknown[]) => Promise.resolve()),
  };
  const snapshots = { snapshotKeyResult: vi.fn((..._a: unknown[]) => Promise.resolve()) };
  const service = new GoalsService(
    prisma as never,
    ACCESS_ALL as never,
    measure as never,
    snapshots as never,
    RBAC as never,
  );
  (service as unknown as { read: () => Promise<unknown> }).read = () => Promise.resolve({ ok: 1 });
  return { service, prisma, measure, snapshots };
}

const bugs: Existing = {
  id: 'k1',
  source: 'OPEN_BUGS',
  sourceConfig: { projectId: 'p1' },
  currentValue: 20,
};
const manual: Existing = { id: 'k2', source: 'MANUAL', sourceConfig: null, currentValue: 6 };
const call = (dtoKr: Record<string, unknown>, svc: ReturnType<typeof makeFormSvc>) =>
  svc.service.update('w1', 'o1', { keyResults: [dtoKr as never] }, 'u1');

describe('GoalsService.update — đường form sửa mục tiêu (I2/I3/I4)', () => {
  it('KR cũ không gửi source → giữ nguồn + cấu hình hiện tại, không kiểm lại, không đụng currentValue', async () => {
    const svc = makeFormSvc([bugs]);
    await call({ id: 'k1', name: 'Bug', targetValue: 0 }, svc);
    expect(svc.measure.validateConfig).not.toHaveBeenCalled();
    const data = (
      svc.prisma.keyResult.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({ source: 'OPEN_BUGS', sourceConfig: { projectId: 'p1' } });
    expect(data).not.toHaveProperty('currentValue');
  });

  it('I2: form gửi lại source+cấu hình KHÔNG đổi (kể cả khác thứ tự khoá) → không validate; đổi cấu hình → validate đúng một lần', async () => {
    const same = makeFormSvc([bugs]);
    await call(
      {
        id: 'k1',
        name: 'Bug',
        targetValue: 0,
        source: 'OPEN_BUGS',
        sourceConfig: { projectId: 'p1' },
      },
      same,
    );
    expect(same.measure.validateConfig).not.toHaveBeenCalled();

    const changed = makeFormSvc([bugs]);
    await call(
      {
        id: 'k1',
        name: 'Bug',
        targetValue: 0,
        source: 'OPEN_BUGS',
        sourceConfig: { projectId: 'p2' },
      },
      changed,
    );
    expect(changed.measure.validateConfig).toHaveBeenCalledTimes(1);
    expect(changed.measure.validateConfig).toHaveBeenCalledWith('w1', 'u1', 'OPEN_BUGS', {
      projectId: 'p2',
    });
    // KR mới luôn được kiểm
    const created = makeFormSvc([]);
    await call(
      {
        name: 'Mới',
        targetValue: 1,
        source: 'ISSUE_COUNT_JQL',
        sourceConfig: { jql: 'type = Bug' },
      },
      created,
    );
    expect(created.measure.validateConfig).toHaveBeenCalledTimes(1);
  });

  it('KR nhập tay đổi currentValue: cập nhật có điều kiện + một dòng check-in (previousValue = số cũ, ghi chú trống)', async () => {
    const svc = makeFormSvc([manual]);
    await call(
      { id: 'k2', name: 'Khách', targetValue: 0, currentValue: 4, expectedCurrentValue: 6 },
      svc,
    );
    expect(svc.prisma.keyResult.updateMany).toHaveBeenCalledWith({
      where: { id: 'k2', currentValue: 6 },
      data: expect.objectContaining({ name: 'Khách', currentValue: 4 }) as unknown,
    });
    expect(svc.prisma.keyResultCheckIn.create).toHaveBeenCalledWith({
      data: { keyResultId: 'k2', value: 4, previousValue: 6, note: null, authorId: 'u1' },
    });
  });

  it('KR nhập tay không gửi currentValue (form không sửa số) → giữ số hiện có, không check-in', async () => {
    const svc = makeFormSvc([manual]);
    await call({ id: 'k2', name: 'Đổi tên', targetValue: 0 }, svc);
    expect(svc.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    const data = (
      svc.prisma.keyResult.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data).not.toHaveProperty('currentValue');
    expect(data).toMatchObject({ name: 'Đổi tên' });
  });
});

describe('GoalsService.update — OCC và chuyển nguồn của KR (I3/I4)', () => {
  it('I3: form mở từ lâu (expectedCurrentValue ≠ số trong DB) → 409, không ghi gì', async () => {
    const svc = makeFormSvc([{ ...manual, currentValue: 4 }]);
    await expect(
      call(
        { id: 'k2', name: 'Khách', targetValue: 0, currentValue: 3, expectedCurrentValue: 6 },
        svc,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('người khác') as unknown,
    });
    expect(svc.prisma.$transaction).not.toHaveBeenCalled();
    expect(svc.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
  });

  it('I3: người khác chen vào giữa lúc đọc và ghi (updateMany count 0) → 409, transaction không ghi check-in', async () => {
    const svc = makeFormSvc([manual]);
    svc.prisma.keyResult.updateMany.mockResolvedValueOnce({ count: 0 });
    (svc.prisma.keyResult as Record<string, unknown>).findFirst = vi.fn(() =>
      Promise.resolve({ currentValue: 5 }),
    );
    await expect(
      call({ id: 'k2', name: 'Khách', targetValue: 0, currentValue: 4 }, svc),
    ).rejects.toMatchObject({ status: 409 });
    expect(svc.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
  });

  it('chuyển TỰ ĐO → NHẬP TAY: lưu nguồn MANUAL + cấu hình null, số nhập là check-in so với điểm xuất phát đang lưu', async () => {
    const svc = makeFormSvc([bugs]);
    await call({ id: 'k1', name: 'Bug', targetValue: 0, source: 'MANUAL', currentValue: 7 }, svc);
    expect(svc.measure.validateConfig).not.toHaveBeenCalled();
    expect(svc.prisma.keyResult.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', currentValue: 20 },
      data: expect.objectContaining({
        source: 'MANUAL',
        sourceConfig: Prisma.DbNull,
        currentValue: 7,
      }) as unknown,
    });
    expect(svc.prisma.keyResultCheckIn.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ keyResultId: 'k1', value: 7, previousValue: 20 }) as unknown,
    });
    expect(svc.snapshots.snapshotKeyResult).not.toHaveBeenCalled();
  });

  it('chuyển NHẬP TAY → TỰ ĐO: kiểm cấu hình mới, bỏ qua currentValue gửi lên, chụp ngay một điểm', async () => {
    const svc = makeFormSvc([manual]);
    svc.prisma.keyResult.findMany
      .mockResolvedValueOnce([manual] as never) // existing trong update()
      .mockResolvedValueOnce([{ id: 'k2' }] as never); // snapshotAutoOf
    await call(
      {
        id: 'k2',
        name: 'Khách',
        targetValue: 0,
        currentValue: 99,
        source: 'OPEN_BUGS',
        sourceConfig: {},
      },
      svc,
    );
    expect(svc.measure.validateConfig).toHaveBeenCalledTimes(1);
    const data = (
      svc.prisma.keyResult.update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({ source: 'OPEN_BUGS' });
    expect(data).not.toHaveProperty('currentValue');
    expect(svc.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
    expect(svc.snapshots.snapshotKeyResult).toHaveBeenCalledWith('k2');
  });
});

describe('GoalsService — che cấu hình nguồn của KR theo quyền người xem (I6) và trung bình tiến độ (M1)', () => {
  const row = (krs: unknown[]) => ({
    id: 'o1',
    workspaceId: 'w1',
    projectId: null,
    name: 'O',
    description: null,
    period: '2026-Q4',
    status: 'ACTIVE',
    ownerId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    owner: null,
    project: null,
    keyResults: krs,
    issues: [],
  });
  const kr = (id: string, source: string, sourceConfig: unknown, currentValue = 0) => ({
    id,
    name: id,
    unit: 'NUMBER',
    startValue: 0,
    targetValue: 10,
    currentValue,
    source,
    sourceConfig,
    unitLabel: null,
    _count: { checkIns: 0 },
    checkIns: [],
  });
  const krs = [
    kr('hidden', 'OPEN_BUGS', { projectId: 'hr' }),
    kr('open', 'SPRINT_COMPLETION', { projectId: 'p1' }),
    kr('all', 'OPEN_BUGS', {}),
    kr('jql', 'ISSUE_COUNT_JQL', { jql: 'project = HR AND text ~ "lương"' }),
    kr('manual', 'MANUAL', null, 5),
  ];

  function make(opts: {
    visibleIds: string[] | null;
    perms: string[];
    measured?: Map<string, unknown>;
  }) {
    const prisma = { objective: { findFirst: vi.fn(() => Promise.resolve(row(krs))) } };
    const access = {
      visibleWhere: vi.fn(() =>
        Promise.resolve(opts.visibleIds === null ? {} : { isPrivate: false }),
      ),
      visibleProjectIds: vi.fn(() => Promise.resolve(opts.visibleIds)),
    };
    const measure = { measure: vi.fn(() => Promise.resolve(opts.measured ?? new Map())) };
    const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(opts.perms))) };
    const service = new GoalsService(
      prisma as never,
      access as never,
      measure as never,
      NO_SNAPSHOT as never,
      rbac as never,
    );
    return { service, access };
  }
  const configs = (g: { keyResults: Array<{ id: string; sourceConfig: unknown }> }) =>
    Object.fromEntries(g.keyResults.map((k) => [k.id, k.sourceConfig]));

  it('không thấy dự án riêng tư và không có GOAL_MANAGE: projectId của dự án ẩn và JQL thô bị che (source vẫn trả)', async () => {
    const { service } = make({ visibleIds: ['p1'], perms: ['workspace:view'] });
    const g = await service.get('w1', 'o1', 'u1');
    expect(configs(g)).toEqual({
      hidden: null,
      open: { projectId: 'p1' },
      all: {},
      jql: null,
      manual: null,
    });
    expect(g.keyResults.map((k) => k.source)).toEqual([
      'OPEN_BUGS',
      'SPRINT_COMPLETION',
      'OPEN_BUGS',
      'ISSUE_COUNT_JQL',
      'MANUAL',
    ]);
  });

  it('có GOAL_MANAGE: JQL thô được trả; dự án riêng tư vẫn che nếu không thấy dự án đó', async () => {
    const { service } = make({ visibleIds: ['p1'], perms: ['workspace:view', 'goal:manage'] });
    const c = configs(await service.get('w1', 'o1', 'u1'));
    expect(c.jql).toEqual({ jql: 'project = HR AND text ~ "lương"' });
    expect(c.hidden).toBeNull();
  });

  it('thấy mọi dự án (visibleProjectIds = null) + GOAL_MANAGE → trả đủ', async () => {
    const { service } = make({ visibleIds: null, perms: ['goal:manage'] });
    const c = configs(await service.get('w1', 'o1', 'u1'));
    expect(c.hidden).toEqual({ projectId: 'hr' });
    expect(c.jql).toEqual({ jql: 'project = HR AND text ~ "lương"' });
  });

  it('M1: KR đo lỗi không kéo trung bình tiến độ mục tiêu xuống', async () => {
    const measured = new Map([
      ['hidden', { value: null, measuredAt: 'x', error: 'Dự án không tồn tại' }],
      ['open', { value: 10, measuredAt: 'x', error: null }],
      ['all', { value: 10, measuredAt: 'x', error: null }],
      ['jql', { value: 10, measuredAt: 'x', error: null }],
    ]);
    const { service } = make({ visibleIds: null, perms: ['goal:manage'], measured });
    const g = await service.get('w1', 'o1', 'u1');
    // 3 KR đo được = 100%, KR nhập tay 5/10 = 50%, KR lỗi bị loại → (100*3+50)/4
    expect(g.keyResultProgress).toBe(88);
  });
});
