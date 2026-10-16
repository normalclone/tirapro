import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, type RoleDto } from '@tirapro/types';
import { buildRoleMatrix } from './roleMatrix';

const role = (id: string, name: string, keys: string[]) =>
  ({
    id,
    name,
    scope: 'PROJECT',
    isSystem: true,
    permissionKeys: keys,
    memberCount: 0,
  }) as unknown as RoleDto;

describe('buildRoleMatrix', () => {
  const roles = [
    role('a', 'Scrum Master', ['issue:create', 'sprint:manage']),
    role('b', 'Product Owner', ['issue:create', 'issue:transition']),
  ];

  it('mỗi hàng có một ô cho mỗi vai trò, đúng thứ tự cột', () => {
    const m = buildRoleMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT' });
    expect(m.columns.map((c) => c.id)).toEqual(['a', 'b']);
    const create = m.rows.find((r) => r.key === 'issue:create')!;
    expect(create.cells).toEqual([true, true]);
    expect(m.rows.find((r) => r.key === 'sprint:manage')!.cells).toEqual([true, false]);
    expect(m.rows.find((r) => r.key === 'issue:transition')!.cells).toEqual([false, true]);
  });

  it('chỉ giữ quyền đúng phạm vi', () => {
    const m = buildRoleMatrix(roles, PERMISSION_CATALOG, { scope: 'WORKSPACE' });
    expect(m.rows.length).toBeGreaterThan(0);
    expect(
      m.rows.every((r) => PERMISSION_CATALOG.find((p) => p.key === r.key)!.scope === 'WORKSPACE'),
    ).toBe(true);
  });

  it('onlyDiff: bỏ hàng mà mọi vai trò giống nhau', () => {
    const m = buildRoleMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT', onlyDiff: true });
    expect(m.rows.some((r) => r.key === 'issue:create')).toBe(false); // cả hai đều có
    expect(m.rows.some((r) => r.key === 'issue:delete')).toBe(false); // cả hai đều không có
    expect(m.rows.some((r) => r.key === 'sprint:manage')).toBe(true);
    expect(m.rows.some((r) => r.key === 'issue:transition')).toBe(true);
  });

  it('nhóm theo tiền tố khoá', () => {
    const m = buildRoleMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT' });
    expect(m.rows.find((r) => r.key === 'issue:create')!.group).toBe('Công việc');
    expect(m.rows.find((r) => r.key === 'sprint:manage')!.group).toBe('Sprint & bảng');
    expect(m.rows.find((r) => r.key === 'report:view')!.group).toBe('Báo cáo');
  });

  it('khoá có tiền tố lạ rơi vào nhóm "Khác"', () => {
    const catalog = [
      ...PERMISSION_CATALOG,
      { key: 'zzz:do' as never, description: 'Quyền lạ', scope: 'PROJECT' as const },
    ];
    const m = buildRoleMatrix(roles, catalog, { scope: 'PROJECT' });
    expect(m.rows.find((r) => (r.key as string) === 'zzz:do')!.group).toBe('Khác');
  });

  it('hàng được gom liền theo nhóm (không xen kẽ) và nhãn lấy từ mô tả quyền', () => {
    const m = buildRoleMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT' });
    const seen: string[] = [];
    for (const r of m.rows) if (seen[seen.length - 1] !== r.group) seen.push(r.group);
    expect(new Set(seen).size).toBe(seen.length);
    expect(m.rows.find((r) => r.key === 'issue:create')!.label).toBe(
      PERMISSION_CATALOG.find((p) => p.key === 'issue:create')!.description,
    );
  });
});
