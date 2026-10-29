import {
  SYSTEM_ROLES,
  roleLabel,
  type PermissionDef,
  type PermissionKey,
  type PermissionScope,
  type RoleDto,
} from '@tirapro/types';

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

export interface MatrixRow {
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

export interface MatrixGroup {
  group: string;
  /** ĐỦ khoá của nhóm trong phạm vi (không bị `onlyDiff` lọc) — ô nhóm bật/tắt cả nhóm theo danh sách này. */
  keys: PermissionKey[];
  /** Dòng con hiển thị khi mở nhóm (đã lọc `onlyDiff`). */
  rows: MatrixRow[];
}

export interface GroupedMatrix {
  columns: RoleDto[];
  groups: MatrixGroup[];
}

/**
 * Dạng "gộp theo nhóm" của ma trận: mỗi nhóm một dòng (ô nhóm 3 trạng thái ở UI), mở ra thấy từng quyền. `onlyDiff` chỉ lọc
 * dòng con; nhóm không còn dòng khác biệt nào thì ẩn. Khoá của nhóm luôn đầy đủ để bấm cả nhóm không bỏ sót quyền đang ẩn.
 */
export function buildGroupedMatrix(
  roles: RoleDto[],
  catalog: PermissionDef[],
  opts: { scope: PermissionScope; onlyDiff?: boolean },
): GroupedMatrix {
  const full = buildRoleMatrix(roles, catalog, { scope: opts.scope });
  const visible = opts.onlyDiff
    ? buildRoleMatrix(roles, catalog, { scope: opts.scope, onlyDiff: true })
    : full;
  const groups: MatrixGroup[] = [];
  for (const row of full.rows) {
    let g = groups.find((x) => x.group === row.group);
    if (!g) groups.push((g = { group: row.group, keys: [], rows: [] }));
    g.keys.push(row.key);
  }
  for (const g of groups) g.rows = visible.rows.filter((r) => r.group === g.group);
  return { columns: roles, groups: groups.filter((g) => g.rows.length > 0) };
}

/** Hai vai trò dự án cũ (chung chung) — vẫn chọn thêm được nhưng không đưa vào bảng mặc định. */
const LEGACY_DEFAULT_OFF = new Set<string>([
  SYSTEM_ROLES.PROJECT_DEVELOPER,
  SYSTEM_ROLES.PROJECT_REPORTER,
]);

/**
 * Cột mặc định của một phạm vi: các vai trò hệ thống (trừ hai vai trò dự án cũ). Người sửa được (`withCustom`) thấy thêm
 * các vai trò TUỲ CHỈNH — đó là thứ họ vào đây để chỉnh, đừng bắt họ tự bật từng chip.
 */
export function defaultColumnIds(
  roles: readonly RoleDto[],
  scope: RoleDto['scope'],
  withCustom: boolean,
): string[] {
  return roles
    .filter((r) => r.scope === scope && (r.isSystem ? !LEGACY_DEFAULT_OFF.has(r.name) : withCustom))
    .map((r) => r.id);
}

/**
 * Thứ tự cột: vai trò hệ thống trước rồi theo tên hiển thị tiếng Việt — thứ tự ổn định giữa các lần mở. Người sửa được
 * (`customFirst`) thì vai trò tuỳ chỉnh lên đầu, sát cột "Quyền".
 */
export function sortMatrixRoles(roles: readonly RoleDto[], customFirst: boolean): RoleDto[] {
  const rank = (r: RoleDto) => Number(customFirst ? r.isSystem : !r.isSystem);
  return [...roles].sort(
    (a, b) => rank(a) - rank(b) || roleLabel(a.name).localeCompare(roleLabel(b.name), 'vi'),
  );
}
