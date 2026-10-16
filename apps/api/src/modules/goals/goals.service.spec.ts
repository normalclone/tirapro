import { describe, expect, it, vi } from 'vitest';
import { GoalsService } from './goals.service';

/** ProjectAccessService giả: người xem thấy mọi dự án (admin) / không có viewer. */
const ACCESS_ALL = { visibleWhere: vi.fn(() => Promise.resolve({})) };
/** KrMeasureService giả: không KR tự đo nào được đo (mặc định cho test không liên quan tới L25). */
const NO_MEASURE = { measure: vi.fn(() => Promise.resolve(new Map())) };

type IssueWhere = { where: Record<string, unknown> };
const LIVE = { deletedAt: null };

describe('GoalsService — không đếm/gắn issue của dự án xoá mềm', () => {
  it('validateIssues: where có project.deletedAt:null (không gắn được issue của dự án đã xoá)', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'i1' }]));
    const service = new GoalsService(
      { issue: { findMany } } as never,
      ACCESS_ALL as never,
      NO_MEASURE as never,
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
    service: new GoalsService(prisma as never, ACCESS_ALL as never, NO_MEASURE as never),
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
      service: new GoalsService(prisma as never, access as never, NO_MEASURE as never),
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
      $transaction: vi.fn(() => Promise.resolve([])),
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
      service: new GoalsService(prisma as never, ACCESS_ALL as never, measure as never),
      measure,
    };
  }

  it('get(): KR OPEN_BUGS trả currentValue = số đo (12) dù DB có 3, progress tính theo 12', async () => {
    const measured = new Map([
      ['k1', { value: 12, measuredAt: '2026-10-16T01:00:00.000Z', error: null }],
    ]);
    const { service, measure } = make([krRow({})], measured);
    const goal = await service.get('w1', 'o1', 'u1');
    expect(measure.measure).toHaveBeenCalledWith('w1', 'u1', [
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
    const service = new GoalsService(prisma as never, ACCESS_ALL as never, measure as never);
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
    expect(manual.prisma.keyResult.update.mock.calls[0]![0]).toMatchObject({
      data: { currentValue: 5 },
    });
    expect(manual.prisma.keyResultCheckIn.create).toHaveBeenCalledTimes(1);
    expect(auto.prisma.keyResultCheckIn.create).not.toHaveBeenCalled();
  });
});

describe('GoalsService — check-in Key Result (L26)', () => {
  function make(
    kr: Record<string, unknown> | null = { id: 'k1', source: 'MANUAL', currentValue: 6 },
  ) {
    const checkInCreate = vi.fn((a?: unknown) => Promise.resolve(a));
    const krUpdate = vi.fn((a?: unknown) => Promise.resolve(a));
    const prisma = {
      objective: {
        findFirst: vi.fn(() =>
          Promise.resolve({ id: 'o1', projectId: null, project: { archivedAt: null } }),
        ),
      },
      keyResult: {
        findFirst: vi.fn(() => Promise.resolve(kr)),
        update: krUpdate,
      },
      keyResultCheckIn: {
        create: checkInCreate,
        findMany: vi.fn((_a?: unknown) => Promise.resolve([])),
      },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const service = new GoalsService(prisma as never, ACCESS_ALL as never, NO_MEASURE as never);
    (service as unknown as { read: () => Promise<unknown> }).read = () =>
      Promise.resolve({ ok: 1 });
    return { service, prisma, checkInCreate, krUpdate };
  }

  it('addCheckIn: ghi dòng lịch sử với previousValue = giá trị cũ + cập nhật currentValue trong MỘT $transaction', async () => {
    const { service, prisma, checkInCreate, krUpdate } = make();
    await service.addCheckIn('w1', 'o1', 'k1', { value: 4, note: 'Đã vá 2 bug lớn' }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(checkInCreate).toHaveBeenCalledWith({
      data: {
        keyResultId: 'k1',
        value: 4,
        previousValue: 6,
        note: 'Đã vá 2 bug lớn',
        authorId: 'u1',
      },
    });
    expect(krUpdate).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { currentValue: 4 } });
  });

  it('addCheckIn: KR tự đo (source != MANUAL) → 422, không ghi', async () => {
    const { service, prisma, checkInCreate } = make({
      id: 'k1',
      source: 'OPEN_BUGS',
      currentValue: 3,
    });
    await expect(service.addCheckIn('w1', 'o1', 'k1', { value: 4 }, 'u1')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('tự đo') as unknown,
    });
    expect(checkInCreate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('addCheckIn: KR không thuộc mục tiêu → 404; dự án lưu trữ → 422 (qua requireObjective)', async () => {
    const missing = make(null);
    await expect(
      missing.service.addCheckIn('w1', 'o1', 'kx', { value: 1 }, 'u1'),
    ).rejects.toMatchObject({
      status: 404,
    });
    const arch = make();
    arch.prisma.objective.findFirst.mockResolvedValueOnce({
      id: 'o1',
      projectId: 'p1',
      project: { archivedAt: new Date() },
    } as never);
    await expect(
      arch.service.addCheckIn('w1', 'o1', 'k1', { value: 1 }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(arch.checkInCreate).not.toHaveBeenCalled();
  });

  it('updateKeyResult(currentValue) trên KR nhập tay đi qua cùng đường check-in (ghi lịch sử, ghi chú trống)', async () => {
    const { service, checkInCreate, krUpdate, prisma } = make();
    await service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 5 }, 'u1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(checkInCreate).toHaveBeenCalledWith({
      data: { keyResultId: 'k1', value: 5, previousValue: 6, note: null, authorId: 'u1' },
    });
    expect((krUpdate.mock.calls[0]![0] as { data: unknown }).data).toMatchObject({
      currentValue: 5,
    });
  });

  it('updateKeyResult chỉ đổi tên/đích (hoặc currentValue không đổi): không ghi check-in', async () => {
    const { service, checkInCreate } = make();
    await service.updateKeyResult('w1', 'o1', 'k1', { name: 'Mới', unitLabel: ' bug ' }, 'u1');
    await service.updateKeyResult('w1', 'o1', 'k1', { currentValue: 6 }, 'u1');
    expect(checkInCreate).not.toHaveBeenCalled();
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
    expect(args[0]!.where).toEqual({ keyResultId: 'k1' });
  });

  it('listCheckIns: KR của mục tiêu không thấy/không có → 404', async () => {
    const { service } = make(null);
    await expect(service.listCheckIns('w1', 'o1', 'k1', 10, 'u1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
