import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@tirapro/types';
import {
  PROJECT_ROLE_PERMISSIONS,
  canCreateProjectRole,
  createProjectRoleBody,
  roleUsageText,
} from './projectRoleForm';
import { defaultInitialRoleId, initialMembers } from '../projects/initialMembers';

const base = {
  mode: 'template' as const,
  name: '',
  templateId: '',
  perms: new Set<PermissionKey>(),
};

describe('Tạo vai trò của dự án', () => {
  it('chỉ liệt kê quyền cấp dự án (không có quyền tổ chức)', () => {
    expect(PROJECT_ROLE_PERMISSIONS.length).toBeGreaterThan(0);
    expect(PROJECT_ROLE_PERMISSIONS.every((p) => p.scope === 'PROJECT')).toBe(true);
    expect(PROJECT_ROLE_PERMISSIONS.some((p) => p.key === 'organization:admin')).toBe(false);
  });

  it('từ mẫu: cần chọn mẫu, tên để trống được', () => {
    expect(canCreateProjectRole({ ...base })).toBe(false);
    expect(canCreateProjectRole({ ...base, templateId: 't1' })).toBe(true);
    expect(createProjectRoleBody({ ...base, templateId: 't1' })).toEqual({ fromTemplateId: 't1' });
    expect(createProjectRoleBody({ ...base, templateId: 't1', name: '  QA  ' })).toEqual({
      fromTemplateId: 't1',
      name: 'QA',
    });
  });

  it('tự chọn quyền: cần tên và ít nhất một quyền', () => {
    const custom = { ...base, mode: 'custom' as const };
    expect(canCreateProjectRole({ ...custom, name: 'QA' })).toBe(false);
    expect(canCreateProjectRole({ ...custom, perms: new Set<PermissionKey>(['issue:edit']) })).toBe(
      false,
    );
    const ok = { ...custom, name: ' QA ', perms: new Set<PermissionKey>(['issue:edit']) };
    expect(canCreateProjectRole(ok)).toBe(true);
    expect(createProjectRoleBody(ok)).toEqual({ name: 'QA', permissionKeys: ['issue:edit'] });
  });

  it('nói số người đang dùng vai trò', () => {
    expect(roleUsageText(0)).toBe('Chưa ai dùng');
    expect(roleUsageText(3)).toBe('3 người đang dùng');
  });
});

describe('Thêm người khi tạo dự án', () => {
  it('mỗi người một vai trò ban đầu', () => {
    expect(initialMembers(['a', 'b'], 'r1')).toEqual([
      { userId: 'a', roleId: 'r1' },
      { userId: 'b', roleId: 'r1' },
    ]);
  });
  it('vai trò mặc định = mẫu Developer, không có thì mẫu đầu, rỗng nếu chưa có mẫu', () => {
    expect(
      defaultInitialRoleId([
        { id: 'a', name: 'Tester' },
        { id: 'b', name: 'Developer' },
      ]),
    ).toBe('b');
    expect(defaultInitialRoleId([{ id: 'a', name: 'Tester' }])).toBe('a');
    expect(defaultInitialRoleId([])).toBe('');
  });
});
