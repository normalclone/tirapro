import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { TriageService } from './triage.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  key: 'D-BUG-7',
  summary: 's',
  projectId: 'p1',
  version: 4,
  description: 'Mô tả',
  reporterId: 'u2',
  reporter: {
    id: 'u2',
    displayName: 'Trang',
    avatarUrl: null,
    email: 'e',
    timezone: 'UTC',
    locale: 'vi',
    status: 'ACTIVE',
    isSystemAdmin: false,
    lastSeenAt: null,
    createdAt: new Date(),
  },
  triageSource: 'FEATURE',
  environment: null,
  lastOccurredAt: null,
  sprintId: null,
  type: {
    id: 't',
    name: 'Bug',
    key: 'BUG',
    iconUrl: null,
    color: null,
    hierarchyLevel: 0,
    isSubtask: false,
  },
  status: {
    id: 's',
    workflowId: 'w',
    name: 'To Do',
    category: 'TODO',
    color: null,
    order: 0,
    isInitial: true,
  },
  priority: null,
  severity: null,
  assignee: null,
  occurrenceCount: 1,
  triageState: 'PENDING',
  triageSnoozeUntil: null,
  createdAt: new Date('2026-10-16T01:00:00Z'),
  ...over,
});

function make(current: Record<string, unknown> = {}) {
  const update = vi.fn((_a: unknown) =>
    Promise.resolve(row({ ...current, triageState: 'ACCEPTED', version: 6 })),
  );
  const prisma = {
    issue: {
      findFirst: vi.fn(() => Promise.resolve(row(current))),
      findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
      findMany: vi.fn(() => Promise.resolve([row(current)])),
      update,
    },
    issueWatcher: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    user: { findUnique: vi.fn(() => Promise.resolve({ displayName: 'Phúc' })) },
  };
  const issues = {
    update: vi.fn((..._a: unknown[]) => Promise.resolve({ version: 5 })),
    isAssignableMember: vi.fn((..._a: unknown[]) => Promise.resolve(true)),
    emitUpdatedFor: vi.fn((..._a: unknown[]) => Promise.resolve({ id: 'i1' })),
  };
  const comments = { create: vi.fn((..._a: unknown[]) => Promise.resolve({ id: 'c1' })) };
  const access = { visibleWhere: vi.fn((..._a: unknown[]) => Promise.resolve({})) };
  const service = new TriageService(
    prisma as never,
    issues as never,
    comments as never,
    access as never,
  );
  return { service, prisma, update, issues, comments, access };
}

describe('TriageService.accept', () => {
  it('có loại/ưu tiên/sprint => IssuesService.update trước, rồi ACCEPTED với version mới', async () => {
    const { service, issues, update } = make();
    await service.accept('w1', 'u1', 'i1', {
      version: 4,
      typeId: 'tStory',
      priorityId: 'pHigh',
      sprintId: 'sp1',
    });
    expect(issues.update).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      expect.objectContaining({
        version: 4,
        typeId: 'tStory',
        priorityId: 'pHigh',
        sprintId: 'sp1',
      }),
    );
    expect(update.mock.calls[0]![0]).toMatchObject({
      data: { triageState: 'ACCEPTED', version: { increment: 1 } },
    });
    // Thứ tự: update của issues phải chạy TRƯỚC khi đặt ACCEPTED.
    expect(issues.update.mock.invocationCallOrder[0]!).toBeLessThan(
      update.mock.invocationCallOrder[0]!,
    );
  });

  it('sprintId null = đưa về Việc chờ', async () => {
    const { service, issues } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4, sprintId: null });
    expect(issues.update).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      expect.objectContaining({ sprintId: null }),
    );
  });

  it('có loại + người phụ trách => assignee đi qua IssuesService.update, không gán lần hai ở bước ACCEPTED', async () => {
    const { service, issues, update } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4, typeId: 't2', assigneeId: 'u5' });
    expect(issues.update.mock.calls[0]![3]).toMatchObject({ assigneeId: 'u5' });
    expect((update.mock.calls[0]![0] as { data: Record<string, unknown> }).data).not.toHaveProperty(
      'assignee',
    );
  });

  it('không có trường nào ngoài triage => không gọi IssuesService.update (giữ đường nhận một chạm)', async () => {
    const { service, issues } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4 });
    expect(issues.update).not.toHaveBeenCalled();
  });

  it('chỉ có assigneeId => gán trực tiếp ở bước ACCEPTED (hành vi cũ)', async () => {
    const { service, issues, update } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4, assigneeId: 'u5' });
    expect(issues.update).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0]).toMatchObject({
      data: { assignee: { connect: { id: 'u5' } } },
    });
  });

  it('version lệch => 409 và không ghi gì', async () => {
    const { service, issues, update } = make();
    await expect(
      service.accept('w1', 'u1', 'i1', { version: 3, typeId: 't2' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(issues.update).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('TriageService.decline', () => {
  it('có lý do => người gửi thành watcher + bình luận chứa lý do', async () => {
    const { service, prisma, comments } = make();
    await service.decline('w1', 'u1', 'i1', { version: 4, reason: 'Ngoài phạm vi quý này' });
    expect(prisma.issueWatcher.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'i1', userId: 'u2' }],
      skipDuplicates: true,
    });
    expect(comments.create).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      expect.objectContaining({
        bodyFormat: 'MARKDOWN',
        body: expect.stringContaining('Ngoài phạm vi quý này') as string,
      }),
    );
  });

  it('không có lý do (hoặc chỉ khoảng trắng) => từ chối thường, không bình luận', async () => {
    const { service, comments } = make();
    await service.decline('w1', 'u1', 'i1', { version: 4 });
    await service.decline('w1', 'u1', 'i1', { version: 4, reason: '   ' });
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('người từ chối chính là người gửi => không tự thêm watcher nhưng vẫn ghi lý do', async () => {
    const { service, prisma, comments } = make({ reporterId: 'u1' });
    await service.decline('w1', 'u1', 'i1', { version: 4, reason: 'Trùng việc khác' });
    expect(prisma.issueWatcher.createMany).not.toHaveBeenCalled();
    expect(comments.create).toHaveBeenCalledTimes(1);
  });

  it('lỗi ghi bình luận không huỷ việc từ chối (đã DECLINED)', async () => {
    const { service, comments, update } = make();
    comments.create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.decline('w1', 'u1', 'i1', { version: 4, reason: 'Ngoài phạm vi' }),
    ).resolves.toBeDefined();
    expect(update.mock.calls[0]![0]).toMatchObject({ data: { triageState: 'DECLINED' } });
  });
});

describe('TriageService.decline/snooze — chỉ việc còn trong hàng đợi', () => {
  const until = '2026-10-20T00:00:00.000Z';

  it.each(['ACCEPTED', 'DECLINED', null])(
    'decline việc triageState=%s => lỗi nghiệp vụ, không ghi gì, không bình luận',
    async (state) => {
      const { service, update, issues, comments } = make({ triageState: state });
      await expect(
        service.decline('w1', 'u1', 'i1', { version: 4, reason: 'Ngoài phạm vi' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(update).not.toHaveBeenCalled();
      expect(issues.emitUpdatedFor).not.toHaveBeenCalled();
      expect(comments.create).not.toHaveBeenCalled();
    },
  );

  it.each(['ACCEPTED', 'DECLINED', null])(
    'snooze việc triageState=%s => lỗi nghiệp vụ, không ghi gì',
    async (state) => {
      const { service, update, issues } = make({ triageState: state });
      await expect(service.snooze('w1', 'u1', 'i1', { version: 4, until })).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(update).not.toHaveBeenCalled();
      expect(issues.emitUpdatedFor).not.toHaveBeenCalled();
    },
  );

  it.each(['PENDING', 'SNOOZED'])('decline và snooze việc %s vẫn chạy', async (state) => {
    const { service, update } = make({ triageState: state });
    await service.decline('w1', 'u1', 'i1', { version: 4 });
    await service.snooze('w1', 'u1', 'i1', { version: 4, until });
    expect(
      update.mock.calls.map((c) => (c[0] as { data: { triageState: string } }).data.triageState),
    ).toEqual(['DECLINED', 'SNOOZED']);
  });
});

describe('TriageService.toDto', () => {
  it('trả mô tả, người gửi, loại yêu cầu từ triageSource', async () => {
    const { service } = make();
    const items = await service.inbox('w1', 'p1', undefined, 50, 'u1');
    expect(items.data[0]).toMatchObject({
      description: 'Mô tả',
      kind: 'FEATURE',
      reporter: { displayName: 'Trang' },
      sprintId: null,
    });
  });

  it('triageSource lạ (không phải BUG/FEATURE/QUESTION) => kind null', async () => {
    const { service } = make({ triageSource: 'API' });
    const items = await service.inbox('w1', 'p1', undefined, 50, 'u1');
    expect(items.data[0]!.kind).toBeNull();
  });
});

describe('TriageService — dự án riêng tư: hộp triage không lộ việc của dự án ẩn (P15)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

  it('inbox không có projectId (cấp workspace) ⇒ where.project = visible', async () => {
    const { service, prisma, access } = make();
    access.visibleWhere.mockResolvedValue(visible);
    await service.inbox('w1', undefined, undefined, 50, 'u1');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    const where = (prisma.issue.findMany.mock.calls[0] as unknown as [{ where: object }])[0].where;
    expect(where).toMatchObject({
      workspaceId: 'w1',
      deletedAt: null,
      project: { deletedAt: null, ...visible },
    });
    expect(where).not.toHaveProperty('projectId');
  });

  it('count (huy hiệu) cùng bộ lọc với inbox', async () => {
    const { service, prisma, access } = make();
    access.visibleWhere.mockResolvedValue(visible);
    (prisma.issue as Record<string, unknown>).count = vi.fn(() => Promise.resolve(3));
    await service.count('w1', undefined, 'u1');
    const count = prisma.issue as unknown as { count: { mock: { calls: [[{ where: object }]] } } };
    expect(count.count.mock.calls[0][0].where).toMatchObject({
      project: { deletedAt: null, ...visible },
    });
  });

  it('người thấy hết dự án (visible = {}) → vẫn loại dự án đã xoá mềm (D-M5)', async () => {
    const { service, prisma } = make();
    await service.inbox('w1', undefined, undefined, 50, 'u1');
    const where = (prisma.issue.findMany.mock.calls[0] as unknown as [{ where: object }])[0].where;
    expect(where).toMatchObject({ project: { deletedAt: null } });
  });
});

describe('TriageService — phát sự kiện đúng dạng IssueDto (S-I2)', () => {
  it('Nhận một chạm: nạp lại IssueDto qua emitUpdatedFor với changedFields gồm triageState', async () => {
    const { service, issues } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4 });
    expect(issues.emitUpdatedFor).toHaveBeenCalledTimes(1);
    expect(issues.emitUpdatedFor).toHaveBeenCalledWith('w1', 'i1', 'u1', ['triageState']);
  });

  it('Nhận kèm người phụ trách mới => changedFields có assigneeId (ISSUE_ASSIGNED cho người được giao) và typeId đổi', async () => {
    const { service, issues, update } = make();
    update.mockResolvedValueOnce(
      row({ triageState: 'ACCEPTED', assigneeId: 'u5', typeId: 't2', version: 6 }),
    );
    await service.accept('w1', 'u1', 'i1', { version: 4, typeId: 't2', assigneeId: 'u5' });
    const fields = issues.emitUpdatedFor.mock.calls[0]![3] as string[];
    expect(fields).toEqual(expect.arrayContaining(['triageState', 'assigneeId', 'typeId']));
    expect(fields.filter((f) => f === 'assigneeId')).toHaveLength(1);
  });

  it('Nhận việc ĐÃ có người phụ trách mặc định (không đổi) => vẫn báo assigneeId vì thông báo bị hoãn từ lúc tạo', async () => {
    const { service, issues, update } = make({ assigneeId: 'u7' });
    update.mockResolvedValueOnce(row({ triageState: 'ACCEPTED', assigneeId: 'u7', version: 6 }));
    await service.accept('w1', 'u1', 'i1', { version: 4 });
    expect(issues.emitUpdatedFor.mock.calls[0]![3]).toEqual(['triageState', 'assigneeId']);
  });

  it('từ chối / tạm hoãn phát changedFields chỉ gồm triageState', async () => {
    const { service, issues, update } = make();
    update.mockResolvedValue(row({ triageState: 'DECLINED', version: 6 }));
    await service.decline('w1', 'u1', 'i1', { version: 4 });
    update.mockResolvedValue(row({ triageState: 'SNOOZED', version: 6 }));
    await service.snooze('w1', 'u1', 'i1', { version: 4, until: '2026-10-20T00:00:00.000Z' });
    expect(issues.emitUpdatedFor.mock.calls.map((c) => c[3])).toEqual([
      ['triageState'],
      ['triageState'],
    ]);
  });

  it('lỗi nạp lại để phát sự kiện không làm hỏng request (dữ liệu đã ghi)', async () => {
    const { service, issues } = make();
    issues.emitUpdatedFor.mockRejectedValueOnce(new Error('db tạm'));
    await expect(service.accept('w1', 'u1', 'i1', { version: 4 })).resolves.toBeDefined();
  });
});

describe('TriageService.accept — kiểm người phụ trách (S-I3)', () => {
  it('một chạm: người không gán được (khác workspace / đã khoá / không thấy dự án) => 422 và không ghi gì', async () => {
    const { service, issues, update } = make();
    issues.isAssignableMember.mockResolvedValueOnce(false);
    await expect(
      service.accept('w1', 'u1', 'i1', { version: 4, assigneeId: 'uX' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(issues.isAssignableMember).toHaveBeenCalledWith('w1', 'uX', undefined, 'p1');
    expect(update).not.toHaveBeenCalled();
    expect(issues.update).not.toHaveBeenCalled();
  });

  it('có trường khác: cũng kiểm TRƯỚC khi IssuesService.update ghi bất cứ thứ gì', async () => {
    const { service, issues } = make();
    issues.isAssignableMember.mockResolvedValueOnce(false);
    await expect(
      service.accept('w1', 'u1', 'i1', { version: 4, typeId: 't2', assigneeId: 'uX' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(issues.update).not.toHaveBeenCalled();
  });

  it('giữ nguyên người phụ trách hiện tại / bỏ gán (null, rỗng) => không kiểm', async () => {
    const { service, issues } = make({ assigneeId: 'u7' });
    await service.accept('w1', 'u1', 'i1', { version: 4, assigneeId: 'u7' });
    await service.accept('w1', 'u1', 'i1', { version: 4, assigneeId: '' });
    expect(issues.isAssignableMember).not.toHaveBeenCalled();
  });
});
