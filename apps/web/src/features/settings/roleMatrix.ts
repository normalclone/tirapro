import type { PermissionDef, PermissionKey, PermissionScope, RoleDto } from '@tirapro/types';

/** Tiền tố khoá quyền (`issue:create` → `issue`) → nhóm chức năng hiển thị. Tiền tố không có ở đây → "Khác". */
const PERMISSION_GROUP_LABEL: Record<string, string> = {
  issue: 'Công việc',
  comment: 'Công việc',
  worklog: 'Công việc',
  sprint: 'Sprint & bảng',
  board: 'Sprint & bảng',
  backlog: 'Sprint & bảng',
  workflow: 'Sprint & bảng',
  customfield: 'Sprint & bảng',
  plan: 'Sprint & bảng',
  automation: 'Sprint & bảng',
  member: 'Thành viên',
  team: 'Thành viên',
  workspace: 'Thành viên',
  report: 'Báo cáo',
  dashboard: 'Báo cáo',
  filter: 'Báo cáo',
  digest: 'Báo cáo',
};

const OTHER_GROUP = 'Khác';
/** Thứ tự các nhóm trên bảng. */
const GROUP_ORDER = ['Công việc', 'Sprint & bảng', 'Thành viên', 'Báo cáo', OTHER_GROUP];

interface MatrixRow {
  key: PermissionKey;
  label: string;
  group: string;
  /** Một ô cho mỗi cột, theo thứ tự `RoleMatrix.columns`. */
  cells: boolean[];
}

export interface RoleMatrix {
  columns: RoleDto[];
  rows: MatrixRow[];
}

function groupOf(key: string): string {
  return PERMISSION_GROUP_LABEL[key.split(':')[0] ?? ''] ?? OTHER_GROUP;
}

/**
 * Ma trận "vai trò × quyền" để so sánh. Cột = `roles` đúng thứ tự truyền vào; hàng = quyền của `scope`, gom theo nhóm
 * chức năng (trong nhóm giữ thứ tự catalog). `onlyDiff` bỏ hàng mà mọi vai trò giống nhau (cùng có hoặc cùng không có).
 */
export function buildRoleMatrix(
  roles: RoleDto[],
  catalog: PermissionDef[],
  opts: { scope: PermissionScope; onlyDiff?: boolean },
): RoleMatrix {
  const granted = roles.map((r) => new Set<string>(r.permissionKeys));
  const rows: MatrixRow[] = catalog
    .filter((p) => p.scope === opts.scope)
    .map((p) => ({
      key: p.key,
      label: p.description,
      group: groupOf(p.key),
      cells: granted.map((g) => g.has(p.key)),
    }))
    .filter((r) => !opts.onlyDiff || r.cells.some((c) => c !== r.cells[0]));
  // Sắp ổn định: theo thứ tự nhóm, trong nhóm giữ thứ tự catalog.
  rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return { columns: roles, rows };
}
