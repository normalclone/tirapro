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
