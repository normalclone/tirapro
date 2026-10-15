import { describe, expect, it, vi } from 'vitest';
import { AutomationService } from './automation.service';

/** runNow là đường công khai gọi createIssueFrom (cùng đường với cron). */
function setup(assignable: boolean) {
  const prisma = {
    recurringIssue: {
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'r1',
          name: 'Báo cáo tuần',
          projectId: 'p1',
          payload: { typeId: 't1', summary: 'Báo cáo', assigneeId: 'gone' },
          project: { id: 'p1', workspaceId: 'w1', leadId: null },
        }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
  const created = { id: 'i1', key: 'P-1' };
  const issues = {
    isAssignableMember: vi.fn(() => Promise.resolve(assignable)),
    create: vi.fn(() => Promise.resolve(created)),
  };
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(['project:admin']))),
  };
  const service = new AutomationService(
    prisma as never,
    issues as never,
    rbac as never,
    {} as never,
  );
  const warn = vi.spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn');
  warn.mockImplementation(() => undefined);
  return { service, issues, warn };
}

describe('AutomationService — tạo việc lặp lại với assignee đã rời workspace', () => {
  it('assignee không còn là thành viên hoạt động => tạo KHÔNG gán + log warn, không ném lỗi', async () => {
    const { service, issues, warn } = setup(false);
    const res = await service.runNow('w1', 'r1', 'u1');
    expect(res.success).toBe(true);
    expect(issues.isAssignableMember).toHaveBeenCalledWith('w1', 'gone');
    expect(issues.create).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ assigneeId: null }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('assignee còn hợp lệ => giữ nguyên, không cảnh báo', async () => {
    const { service, issues, warn } = setup(true);
    await service.runNow('w1', 'r1', 'u1');
    expect(issues.create).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ assigneeId: 'gone' }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

/** Dự án đã lưu trữ là chỉ đọc (BUG-5): việc lặp lại + mẫu việc theo dự án không ghi, cron không quét. */
function setupArchived() {
  const archived = { id: 'p1', archivedAt: new Date() };
  const tpl = {
    id: 't1',
    workspaceId: 'w1',
    projectId: 'p1',
    name: 'Mẫu',
    description: null,
    payload: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    project: { id: 'p1', key: 'P', name: 'P' },
  };
  const rec = {
    id: 'r1',
    projectId: 'p1',
    name: 'Lặp',
    freq: 'WEEKLY',
    interval: 1,
    weekday: 1,
    monthDay: null,
    hour: 8,
    payload: { typeId: 't1', summary: 'x' },
    active: true,
    nextRunAt: new Date(),
    lastRunAt: null,
    createdById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      id: 'p1',
      key: 'P',
      name: 'P',
      workspaceId: 'w1',
      leadId: null,
      archivedAt: archived.archivedAt,
    },
  };
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve(archived)),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived.archivedAt })),
    },
    issueTemplate: {
      findFirst: vi.fn(() => Promise.resolve(tpl)),
      create: vi.fn(() => Promise.resolve({ id: 't2' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    recurringIssue: {
      findFirst: vi.fn(() => Promise.resolve(rec)),
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 'r2' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
  };
  const issues = { create: vi.fn(() => Promise.resolve({ id: 'i1' })) };
  const rbac = {
    getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(['project:admin']))),
  };
  const service = new AutomationService(
    prisma as never,
    issues as never,
    rbac as never,
    {} as never,
  );
  return { service, prisma, issues };
}

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

describe('AutomationService — dự án lưu trữ là chỉ đọc', () => {
  it('createTemplate/updateTemplate/removeTemplate theo dự án => 422, không ghi', async () => {
    const { service, prisma } = setupArchived();
    await expect(
      service.createTemplate('w1', { name: 'M', projectId: 'p1', payload: {} }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.updateTemplate('w1', 't1', { name: 'Mới' }, 'u1')).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.removeTemplate('w1', 't1', 'u1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.issueTemplate.create).not.toHaveBeenCalled();
    expect(prisma.issueTemplate.update).not.toHaveBeenCalled();
    expect(prisma.issueTemplate.delete).not.toHaveBeenCalled();
  });

  it('updateTemplate chuyển mẫu sang dự án đã lưu trữ => 422', async () => {
    const { service, prisma } = setupArchived();
    prisma.issueTemplate.findFirst.mockResolvedValueOnce({
      id: 't1',
      workspaceId: 'w1',
      projectId: null,
      name: 'Chung',
      description: null,
      payload: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      project: null,
    } as never);
    await expect(
      service.updateTemplate('w1', 't1', { projectId: 'p1' }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    expect(prisma.issueTemplate.update).not.toHaveBeenCalled();
  });

  it('createRecurring/updateRecurring/removeRecurring/runNow => 422, không ghi, không tạo issue', async () => {
    const { service, prisma, issues } = setupArchived();
    await expect(
      service.createRecurring(
        'w1',
        {
          name: 'L',
          projectId: 'p1',
          freq: 'WEEKLY',
          interval: 1,
          weekday: 1,
          hour: 8,
          payload: { typeId: 't1', summary: 'x' },
        } as never,
        'u1',
      ),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(
      service.updateRecurring('w1', 'r1', { active: false }, 'u1'),
    ).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeRecurring('w1', 'r1', 'u1')).rejects.toMatchObject(ARCHIVED);
    await expect(service.runNow('w1', 'r1', 'u1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.recurringIssue.create).not.toHaveBeenCalled();
    expect(prisma.recurringIssue.update).not.toHaveBeenCalled();
    expect(prisma.recurringIssue.delete).not.toHaveBeenCalled();
    expect(issues.create).not.toHaveBeenCalled();
  });

  it('cron: scanDueRecurring chỉ quét việc lặp lại của dự án chưa lưu trữ', async () => {
    const { service, prisma } = setupArchived();
    await (service as unknown as { scanDueRecurring(): Promise<void> }).scanDueRecurring();
    expect(prisma.recurringIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ project: { archivedAt: null } }) as unknown,
      }),
    );
  });
});
