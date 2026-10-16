import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  PERMISSIONS as P,
  SYSTEM_ROLES as R,
  SYSTEM_ROLE_PERMISSIONS as RP,
} from '@tirapro/types';

const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));

describe('bộ quyền mặc định của vai trò hệ thống', () => {
  it('mọi quyền được cấp đều có trong catalog', () => {
    for (const [role, keys] of Object.entries(RP)) {
      for (const k of keys) expect(catalog.has(k), `${role}: ${k}`).toBe(true);
    }
  });

  it('Scrum Master tạo được công việc và triage', () => {
    expect(RP[R.SCRUM_MASTER]).toEqual(expect.arrayContaining([P.ISSUE_CREATE, P.ISSUE_TRIAGE]));
  });

  it('issue:triage (API enforce ở /triage/*): quản trị/PM/SM/BA/PO/Tester có; Developer/Reporter/Designer không', () => {
    for (const role of [
      R.WORKSPACE_ADMIN,
      R.PROJECT_ADMIN,
      R.SCRUM_MASTER,
      R.BUSINESS_ANALYST,
      R.PRODUCT_OWNER,
      R.TESTER,
    ])
      expect(RP[role], role).toContain(P.ISSUE_TRIAGE);
    for (const role of [R.DEVELOPER, R.PROJECT_REPORTER, R.DESIGNER, R.WORKSPACE_MEMBER])
      expect(RP[role], role).not.toContain(P.ISSUE_TRIAGE);
  });

  it('Product Owner chuyển được trạng thái (kéo thẻ)', () => {
    expect(RP[R.PRODUCT_OWNER]).toContain(P.ISSUE_TRANSITION);
  });

  it('vai trò quản sprint/backlog đều tạo được công việc', () => {
    for (const role of [R.BUSINESS_ANALYST, R.PRODUCT_OWNER, R.SCRUM_MASTER, R.PROJECT_ADMIN]) {
      expect(RP[role], role).toContain(P.ISSUE_CREATE);
    }
  });

  it('ai quản lý sprint thì cũng quản lý được backlog', () => {
    for (const [role, keys] of Object.entries(RP)) {
      if (keys.includes(P.SPRINT_MANAGE)) expect(keys, role).toContain(P.BACKLOG_MANAGE);
    }
  });

  it('ai sửa được mọi issue thì được bình luận', () => {
    for (const [role, keys] of Object.entries(RP)) {
      if (keys.includes(P.ISSUE_EDIT)) expect(keys, role).toContain(P.COMMENT_CREATE);
    }
  });
});
