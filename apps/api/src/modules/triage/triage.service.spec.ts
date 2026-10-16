import { describe, expect, it, vi } from 'vitest';
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
  const events = { emit: vi.fn() };
  const issues = { update: vi.fn((..._a: unknown[]) => Promise.resolve({ version: 5 })) };
  const comments = { create: vi.fn((..._a: unknown[]) => Promise.resolve({ id: 'c1' })) };
  const service = new TriageService(
    prisma as never,
    events as never,
    issues as never,
    comments as never,
  );
  return { service, prisma, update, events, issues, comments };
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
      undefined,
      false,
    );
    expect(update.mock.calls[0]![0]).toMatchObject({
      data: { triageState: 'ACCEPTED', version: { increment: 1 } },
    });
    // Thứ tự: update của issues phải chạy TRƯỚC khi đặt ACCEPTED.
    expect(issues.update.mock.invocationCallOrder[0]!).toBeLessThan(
      update.mock.invocationCallOrder[0]!,
    );
  });

  it('truyền ownOnly xuống IssuesService.update; sprintId null = đưa về Việc chờ', async () => {
    const { service, issues } = make();
    await service.accept('w1', 'u1', 'i1', { version: 4, sprintId: null }, true);
    expect(issues.update).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      expect.objectContaining({ sprintId: null }),
      undefined,
      true,
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

describe('TriageService.toDto', () => {
  it('trả mô tả, người gửi, loại yêu cầu từ triageSource', async () => {
    const { service } = make();
    const items = await service.inbox('w1', 'p1', undefined, 50);
    expect(items.data[0]).toMatchObject({
      description: 'Mô tả',
      kind: 'FEATURE',
      reporter: { displayName: 'Trang' },
      sprintId: null,
    });
  });

  it('triageSource lạ (không phải BUG/FEATURE/QUESTION) => kind null', async () => {
    const { service } = make({ triageSource: 'API' });
    const items = await service.inbox('w1', 'p1', undefined, 50);
    expect(items.data[0]!.kind).toBeNull();
  });
});
