import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from '@tirapro/types';

describe('Danh mục quyền vai trò hệ thống (logbug #4, #7)', () => {
  it('Workspace Member không có quyền tạo dự án; Workspace Admin vẫn có', () => {
    expect(SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.WORKSPACE_MEMBER]).not.toContain(
      PERMISSIONS.PROJECT_CREATE,
    );
    expect(SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.WORKSPACE_ADMIN]).toContain(
      PERMISSIONS.PROJECT_CREATE,
    );
  });

  it.each([SYSTEM_ROLES.BUSINESS_ANALYST, SYSTEM_ROLES.DEVELOPER, SYSTEM_ROLES.TESTER])(
    '%s chuyển trạng thái issue của mình và của người khác (issue:transition, không chỉ :own)',
    (role) => {
      const perms = SYSTEM_ROLE_PERMISSIONS[role];
      expect(perms).toContain(PERMISSIONS.ISSUE_TRANSITION);
      expect(perms).not.toContain(`${PERMISSIONS.ISSUE_TRANSITION}:own`);
      expect(perms).not.toContain(PERMISSIONS.PROJECT_CREATE);
    },
  );
});
