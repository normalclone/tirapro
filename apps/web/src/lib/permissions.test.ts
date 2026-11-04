import { describe, expect, it } from 'vitest';
import { allowedWhenArchived, canEditIssue, hasPermission } from './permissions';

describe('hasPermission', () => {
  const base = {
    isSystemAdmin: false,
    organization: ['project:view'],
    project: ['worklog:create'],
  };
  it('quyền ở dự án mà organization không có → true', () =>
    expect(hasPermission(base, 'worklog:create')).toBe(true));
  it('quyền ở organization → true kể cả khi dự án chưa tải', () =>
    expect(hasPermission({ ...base, project: undefined }, 'project:view')).toBe(true));
  it('không có ở đâu → false', () => expect(hasPermission(base, 'issue:delete')).toBe(false));
  it('system admin luôn true', () =>
    expect(hasPermission({ ...base, isSystemAdmin: true }, 'issue:delete')).toBe(true));
  it('không suy :own từ quyền đầy đủ và ngược lại', () => {
    expect(hasPermission({ ...base, project: ['issue:edit:own'] }, 'issue:edit')).toBe(false);
  });
});

describe('canEditIssue', () => {
  const issue = { reporterId: 'r', assigneeId: 'a', createdById: 'c' };
  const ctx = (project: string[], isSystemAdmin = false) => ({
    isSystemAdmin,
    organization: [],
    project,
  });
  it('có issue:edit → sửa mọi issue', () =>
    expect(canEditIssue(ctx(['issue:edit']), issue, 'x')).toBe(true));
  it('chỉ issue:edit:own → chỉ issue của mình (reporter/assignee/creator)', () => {
    const c = ctx(['issue:edit:own']);
    expect(canEditIssue(c, issue, 'r')).toBe(true);
    expect(canEditIssue(c, issue, 'a')).toBe(true);
    expect(canEditIssue(c, issue, 'c')).toBe(true);
    expect(canEditIssue(c, issue, 'x')).toBe(false);
  });
  it('không có userId → false với :own', () =>
    expect(canEditIssue(ctx(['issue:edit:own']), issue, undefined)).toBe(false));
  it('không có quyền nào → false', () => expect(canEditIssue(ctx([]), issue, 'r')).toBe(false));
  it('system admin luôn true', () => expect(canEditIssue(ctx([], true), issue, 'x')).toBe(true));
});

describe('allowedWhenArchived', () => {
  it('chỉ nhóm đọc còn lại khi dự án lưu trữ', () => {
    for (const p of ['project:view', 'report:view', 'organization:view'])
      expect(allowedWhenArchived(p)).toBe(true);
    for (const p of [
      'issue:create',
      'issue:transition',
      'issue:assign',
      'backlog:manage',
      'sprint:manage',
      'board:manage',
      'worklog:create',
      'project:admin',
    ])
      expect(allowedWhenArchived(p)).toBe(false);
  });
});

// Điểm ước lượng: quyền sửa = canEditIssue (không có luật riêng — B7). Test chốt hợp đồng này.
describe('quyền sửa điểm = canEditIssue (B7/B10)', () => {
  const issue = { reporterId: 'r', assigneeId: 'a', createdById: 'c' };
  const ctx = (project: string[]) => ({ isSystemAdmin: false, organization: [], project });
  it('issue:edit: sửa điểm việc của người khác (không cần là người tạo, không cần backlog:manage)', () =>
    expect(canEditIssue(ctx(['issue:edit']), issue, 'someone-else')).toBe(true));
  it('issue:edit:own: chỉ việc của mình (báo cáo/được giao/tạo)', () => {
    expect(canEditIssue(ctx(['issue:edit:own']), issue, 'a')).toBe(true);
    expect(canEditIssue(ctx(['issue:edit:own']), issue, 'someone-else')).toBe(false);
  });
  it('chỉ backlog:manage (không issue:edit) => KHÔNG sửa được điểm', () =>
    expect(canEditIssue(ctx(['backlog:manage']), issue, 'a')).toBe(false));
});
