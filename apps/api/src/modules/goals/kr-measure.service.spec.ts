import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { KrMeasureService, type MeasurableKr } from './kr-measure.service';

const VISIBLE = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

function make() {
  const prisma = {
    issue: {
      count: vi.fn((_a?: unknown) => Promise.resolve(12)),
      aggregate: vi.fn((a: { where: { status?: unknown } }) =>
        Promise.resolve({ _sum: { storyPoints: a.where.status ? 18 : 24 } }),
      ),
    },
    sprint: { findFirst: vi.fn((_a?: unknown) => Promise.resolve(null as unknown)) },
    project: { findFirst: vi.fn((_a?: unknown) => Promise.resolve({ id: 'p1' } as unknown)) },
  };
  const access = { visibleWhere: vi.fn(() => Promise.resolve(VISIBLE)) };
  const search = {
    count: vi.fn((..._a: unknown[]) => Promise.resolve(7)),
    countPublic: vi.fn((..._a: unknown[]) => Promise.resolve(5)),
    dependsOnViewer: vi.fn((..._a: unknown[]) => false),
  };
  const service = new KrMeasureService(prisma as never, access as never, search as never);
  return { service, prisma, access, search };
}

const kr = (id: string, source: MeasurableKr['source'], sourceConfig: unknown): MeasurableKr => ({
  id,
  source,
  sourceConfig: sourceConfig as MeasurableKr['sourceConfig'],
});

const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
  (fn.mock.calls[i] as unknown as [{ where: Record<string, unknown> }])[0].where;

describe('KrMeasureService.measure (L25)', () => {
  it('OPEN_BUGS: đếm BUG chưa Done, dự án chưa xoá + điều kiện người xem thấy', async () => {
    const { service, prisma } = make();
    const out = await service.measure('w1', { viewerId: 'u1' }, [kr('k1', 'OPEN_BUGS', {})]);
    expect(out.get('k1')).toMatchObject({ value: 12, error: null });
    expect(out.get('k1')!.measuredAt).toEqual(expect.any(String));
    expect(whereOf(prisma.issue.count)).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      // cùng định nghĩa 'bug' với báo cáo QA / CSV: key BUG hoặc tên Bug
      type: { OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }] },
      status: { category: { not: 'DONE' } },
      project: { deletedAt: null, ...VISIBLE },
    });
  });

  it('OPEN_BUGS có projectId: giới hạn đúng dự án', async () => {
    const { service, prisma } = make();
    await service.measure('w1', { viewerId: 'u1' }, [kr('k1', 'OPEN_BUGS', { projectId: 'p1' })]);
    expect(whereOf(prisma.issue.count)).toMatchObject({ projectId: 'p1' });
  });

  it('SPRINT_COMPLETION: sprint ACTIVE cam kết 24 điểm, Done 18 → 75', async () => {
    const { service, prisma } = make();
    prisma.sprint.findFirst.mockResolvedValueOnce({ id: 's1' });
    const out = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'SPRINT_COMPLETION', { projectId: 'p1' }),
    ]);
    expect(out.get('k1')).toMatchObject({ value: 75, error: null });
    expect(whereOf(prisma.sprint.findFirst)).toMatchObject({
      projectId: 'p1',
      state: 'ACTIVE',
      deletedAt: null,
    });
    const wheres = prisma.issue.aggregate.mock.calls.map((c) => c[0].where);
    expect(wheres[0]).toMatchObject({ sprintId: 's1', deletedAt: null });
    expect(wheres[1]).toMatchObject({ sprintId: 's1', status: { category: 'DONE' } });
  });

  it('không có sprint ACTIVE → dùng sprint CLOSED gần nhất', async () => {
    const { service, prisma } = make();
    prisma.sprint.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's0' });
    await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'SPRINT_COMPLETION', { projectId: 'p1' }),
    ]);
    expect(whereOf(prisma.sprint.findFirst, 1)).toMatchObject({ projectId: 'p1', state: 'CLOSED' });
    expect(
      (prisma.sprint.findFirst.mock.calls[1] as unknown as [{ orderBy: unknown }])[0].orderBy,
    ).toEqual([{ completeDate: 'desc' }, { sequence: 'desc' }]);
  });

  it('sprint không điểm → 0; không sprint nào → 0', async () => {
    const { service, prisma } = make();
    prisma.sprint.findFirst.mockResolvedValue(null);
    prisma.issue.aggregate.mockResolvedValue({ _sum: { storyPoints: null as never } });
    const out = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'SPRINT_COMPLETION', { projectId: 'p1' }),
    ]);
    expect(out.get('k1')).toMatchObject({ value: 0, error: null });
  });

  it('dự án riêng tư người xem không thấy → measureError, không lộ số', async () => {
    const { service, prisma } = make();
    prisma.project.findFirst.mockResolvedValueOnce(null);
    const out = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'SPRINT_COMPLETION', { projectId: 'hr' }),
    ]);
    expect(out.get('k1')).toMatchObject({ value: null });
    expect(out.get('k1')!.error).toEqual(expect.any(String));
    expect(prisma.sprint.findFirst).not.toHaveBeenCalled();
  });

  it('ISSUE_COUNT_JQL: gọi SearchService.count; JQL lỗi → measureError, không ném', async () => {
    const { service, search } = make();
    const out = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'ISSUE_COUNT_JQL', { jql: 'statusCategory = DONE' }),
    ]);
    expect(search.count).toHaveBeenCalledWith('w1', 'u1', 'statusCategory = DONE');
    expect(out.get('k1')).toMatchObject({ value: 7, error: null });

    search.count.mockRejectedValueOnce(new BusinessRuleException('JQL không hợp lệ: x'));
    const bad = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k2', 'ISSUE_COUNT_JQL', { jql: 'zzz' }),
    ]);
    expect(bad.get('k2')).toMatchObject({ value: null, error: 'JQL không hợp lệ: x' });
  });

  it('hai KR cùng cấu hình → đếm một lần; KR nhập tay không có trong kết quả', async () => {
    const { service, prisma } = make();
    const out = await service.measure('w1', { viewerId: 'u1' }, [
      kr('k1', 'OPEN_BUGS', {}),
      kr('k2', 'OPEN_BUGS', {}),
      kr('k3', 'MANUAL', null),
    ]);
    expect(prisma.issue.count).toHaveBeenCalledTimes(1);
    expect(out.get('k1')!.value).toBe(12);
    expect(out.get('k2')!.value).toBe(12);
    expect(out.has('k3')).toBe(false);
  });
});

describe('KrMeasureService.validateConfig (L25)', () => {
  it('JQL dùng currentUser/me → 422 ngay lúc lưu KR tự đo (lịch sử cần số không phụ thuộc người xem)', async () => {
    const { service, search } = make();
    Object.assign(search, { validate: vi.fn(() => Promise.resolve({ valid: true })) });
    search.dependsOnViewer.mockReturnValueOnce(true);
    await expect(
      service.validateConfig('w1', 'u1', 'ISSUE_COUNT_JQL', { jql: 'assignee = me' }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'JQL của KR tự đo không được dùng currentUser/me',
    });
  });

  it('JQL không hợp lệ → 422 với thông điệp của validate; hợp lệ → qua', async () => {
    const { service, search } = make();
    Object.assign(search, {
      validate: vi
        .fn()
        .mockResolvedValueOnce({ valid: true })
        .mockResolvedValueOnce({ valid: false, error: 'Không có loại "Bugg"' }),
    });
    await expect(
      service.validateConfig('w1', 'u1', 'ISSUE_COUNT_JQL', { jql: 'type = Bug' }),
    ).resolves.toBeUndefined();
    await expect(
      service.validateConfig('w1', 'u1', 'ISSUE_COUNT_JQL', { jql: 'type = Bugg' }),
    ).rejects.toMatchObject({ status: 422, message: 'Không có loại "Bugg"' });
  });

  it('projectId không thuộc workspace/không thấy → 404 Dự án; không projectId → qua', async () => {
    const { service, prisma } = make();
    prisma.project.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.validateConfig('w1', 'u1', 'OPEN_BUGS', { projectId: 'hr' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(whereOf(prisma.project.findFirst)).toMatchObject({
      id: 'hr',
      workspaceId: 'w1',
      deletedAt: null,
      ...VISIBLE,
    });
    await expect(service.validateConfig('w1', 'u1', 'OPEN_BUGS', {})).resolves.toBeUndefined();
  });
});

describe("KrMeasureService.measure — phạm vi 'public' (cron chụp lịch sử, L29)", () => {
  it('OPEN_BUGS không dự án: chỉ dự án CÔNG KHAI, không dùng điều kiện người xem', async () => {
    const { service, prisma, access } = make();
    const out = await service.measure('w1', 'public', [kr('k1', 'OPEN_BUGS', {})]);
    expect(out.get('k1')).toMatchObject({ value: 12, error: null });
    expect(access.visibleWhere).not.toHaveBeenCalled();
    expect(whereOf(prisma.issue.count)).toMatchObject({
      workspaceId: 'w1',
      type: { OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }] },
      project: { deletedAt: null, isPrivate: false },
    });
  });

  it('OPEN_BUGS có projectId: đo đúng dự án đó (kể cả riêng tư), vẫn bỏ dự án đã xoá', async () => {
    const { service, prisma } = make();
    await service.measure('w1', 'public', [kr('k1', 'OPEN_BUGS', { projectId: 'hr' })]);
    const w = whereOf(prisma.issue.count);
    expect(w).toMatchObject({ projectId: 'hr', project: { deletedAt: null } });
    expect(JSON.stringify(w)).not.toContain('isPrivate');
  });

  it('SPRINT_COMPLETION: dự án tra theo workspace + chưa xoá, không lọc quyền người xem', async () => {
    const { service, prisma, access } = make();
    prisma.sprint.findFirst.mockResolvedValueOnce({ id: 's1' });
    const out = await service.measure('w1', 'public', [
      kr('k1', 'SPRINT_COMPLETION', { projectId: 'hr' }),
    ]);
    expect(out.get('k1')).toMatchObject({ value: 75 });
    expect(access.visibleWhere).not.toHaveBeenCalled();
    expect(whereOf(prisma.project.findFirst)).toEqual({
      id: 'hr',
      workspaceId: 'w1',
      deletedAt: null,
    });
  });

  it('ISSUE_COUNT_JQL: đếm qua SearchService.countPublic', async () => {
    const { service, search } = make();
    const out = await service.measure('w1', 'public', [
      kr('k1', 'ISSUE_COUNT_JQL', { jql: 'statusCategory = DONE' }),
    ]);
    expect(search.countPublic).toHaveBeenCalledWith('w1', 'statusCategory = DONE');
    expect(search.count).not.toHaveBeenCalled();
    expect(out.get('k1')).toMatchObject({ value: 5, error: null });
  });
});
