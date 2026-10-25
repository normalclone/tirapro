import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, type RoleDto } from '@tirapro/types';
import {
  buildGroupedMatrix,
  buildRoleMatrix,
  defaultColumnIds,
  sortMatrixRoles,
} from './roleMatrix';

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

describe('buildGroupedMatrix (chế độ gộp theo nhóm)', () => {
  const roles = [
    role('a', 'Scrum Master', ['issue:create', 'sprint:manage']),
    role('b', 'Product Owner', ['issue:create', 'issue:transition']),
  ];

  it('mỗi nhóm giữ ĐỦ khoá của nhóm trong phạm vi (để bấm cả nhóm), theo thứ tự nhóm và catalog', () => {
    const g = buildGroupedMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT' });
    const names = g.groups.map((x) => x.group);
    expect(names.indexOf('Công việc')).toBeLessThan(names.indexOf('Sprint & bảng'));
    const work = g.groups.find((x) => x.group === 'Công việc')!;
    const expected = PERMISSION_CATALOG.filter(
      (p) =>
        p.scope === 'PROJECT' && ['issue', 'comment', 'worklog'].includes(p.key.split(':')[0]!),
    ).map((p) => p.key);
    expect(work.keys).toEqual(expected);
    expect(work.rows.map((r) => r.key)).toEqual(expected);
  });

  it('onlyDiff chỉ lọc các dòng con hiển thị; khoá của nhóm (để bấm cả nhóm) vẫn đầy đủ; nhóm hết dòng khác biệt thì ẩn', () => {
    const g = buildGroupedMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT', onlyDiff: true });
    const work = g.groups.find((x) => x.group === 'Công việc')!;
    expect(work.rows.map((r) => r.key).sort()).toEqual(['issue:transition']);
    expect(work.keys.length).toBeGreaterThan(work.rows.length);
    expect(g.groups.every((x) => x.rows.length > 0)).toBe(true);
    expect(g.groups.find((x) => x.group === 'Báo cáo')).toBeUndefined();
  });

  it('cột giữ nguyên thứ tự truyền vào', () => {
    expect(
      buildGroupedMatrix(roles, PERMISSION_CATALOG, { scope: 'PROJECT' }).columns.map((c) => c.id),
    ).toEqual(['a', 'b']);
  });
});

describe('defaultColumnIds', () => {
  const r = (id: string, name: string, scope: string, isSystem: boolean) =>
    ({ id, name, scope, isSystem, permissionKeys: [] }) as unknown as RoleDto;
  const all = [
    r('s1', 'Scrum Master', 'PROJECT', true),
    r('legacy', 'Project Developer', 'PROJECT', true),
    r('c1', 'QA Lead', 'PROJECT', false),
    r('w1', 'Workspace Admin', 'WORKSPACE', true),
    r('cw', 'Kế toán', 'WORKSPACE', false),
  ];
  it('người chỉ đọc: vai trò hệ thống của phạm vi, trừ hai vai trò dự án cũ', () => {
    expect(defaultColumnIds(all, 'PROJECT', false)).toEqual(['s1']);
    expect(defaultColumnIds(all, 'WORKSPACE', false)).toEqual(['w1']);
  });
  it('người sửa được: thêm vai trò tuỳ chỉnh của đúng phạm vi', () => {
    expect(defaultColumnIds(all, 'PROJECT', true)).toEqual(['s1', 'c1']);
    expect(defaultColumnIds(all, 'WORKSPACE', true)).toEqual(['w1', 'cw']);
  });
});

describe('sortMatrixRoles', () => {
  const r = (id: string, name: string, isSystem: boolean) =>
    ({ id, name, scope: 'PROJECT', isSystem, permissionKeys: [] }) as unknown as RoleDto;
  const all = [
    r('c2', 'Zeta', false),
    r('s1', 'Tester', true),
    r('c1', 'Alpha', false),
    r('s2', 'Developer', true),
  ];
  it('chỉ đọc: vai trò hệ thống trước, trong nhóm theo tên hiển thị (tiếng Việt)', () => {
    const ids = sortMatrixRoles(all, false).map((x) => x.id);
    expect(ids.slice(0, 2).sort()).toEqual(['s1', 's2']);
    expect(ids.slice(2)).toEqual(['c1', 'c2']);
  });
  it('người sửa được: vai trò tuỳ chỉnh LÊN ĐẦU (sát cột "Quyền", không phải cuộn ngang mới thấy)', () => {
    const ids = sortMatrixRoles(all, true).map((x) => x.id);
    expect(ids.slice(0, 2)).toEqual(['c1', 'c2']);
    expect(ids.slice(2).sort()).toEqual(['s1', 's2']);
  });
  it('không sửa mảng đầu vào', () => {
    const copy = [...all];
    sortMatrixRoles(all, true);
    expect(all).toEqual(copy);
  });
});
