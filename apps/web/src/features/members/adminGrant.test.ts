import { describe, expect, it } from 'vitest';
import {
  ADMIN_GRANT_REASON,
  frozenAdminRoles,
  groupLockedForAdminGrant,
  permLockedForAdminGrant,
  roleLockedForAdminGrant,
} from './adminGrant';

const ADMIN = 'workspace:admin';

describe('adminGrant (P-C14, web phản chiếu máy chủ)', () => {
  it('lý do ngắn thống nhất', () => {
    expect(ADMIN_GRANT_REASON).toBe('Chỉ quản trị mới cấp/gỡ quyền này');
  });

  it('frozenAdminRoles: người không phải quản trị bị đóng băng MỌI vai trò mang workspace:admin; quản trị thì rỗng', () => {
    const admins = new Set(['a1', 'a2']);
    expect(frozenAdminRoles(false, admins)).toEqual({
      a1: ADMIN_GRANT_REASON,
      a2: ADMIN_GRANT_REASON,
    });
    expect(frozenAdminRoles(true, admins)).toEqual({});
    expect(frozenAdminRoles(false, new Set())).toEqual({});
  });

  it('roleLockedForAdminGrant: vai trò đang giữ workspace:admin bị khoá với người không phải quản trị', () => {
    expect(roleLockedForAdminGrant(false, [ADMIN, 'member:manage'])).toBe(true);
    expect(roleLockedForAdminGrant(false, ['issue:edit'])).toBe(false);
    expect(roleLockedForAdminGrant(true, [ADMIN])).toBe(false);
  });

  it('permLockedForAdminGrant: ô workspace:admin của MỌI vai trò, và mọi ô của vai trò đang giữ nó', () => {
    expect(permLockedForAdminGrant(false, ['issue:edit'], ADMIN)).toBe(true);
    expect(permLockedForAdminGrant(false, [ADMIN], 'issue:edit')).toBe(true);
    expect(permLockedForAdminGrant(false, ['issue:edit'], 'issue:create')).toBe(false);
    expect(permLockedForAdminGrant(true, [ADMIN], ADMIN)).toBe(false);
  });

  it('groupLockedForAdminGrant: nhóm chứa workspace:admin hoặc vai trò đang giữ nó', () => {
    expect(groupLockedForAdminGrant(false, ['issue:edit'], [ADMIN, 'member:manage'])).toBe(true);
    expect(groupLockedForAdminGrant(false, [ADMIN], ['issue:edit'])).toBe(true);
    expect(groupLockedForAdminGrant(false, ['issue:edit'], ['issue:create'])).toBe(false);
    expect(groupLockedForAdminGrant(true, [ADMIN], [ADMIN])).toBe(false);
  });
});
