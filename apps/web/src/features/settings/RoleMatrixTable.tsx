import { Fragment, useId, useMemo, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  roleLabel,
  type PermissionScope,
  type RoleDto,
} from '@tirapro/types';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { cn } from '@/lib/utils';
import { buildRoleMatrix, type RoleMatrix } from './roleMatrix';

/** Cột "Quyền": dính trái, hẹp trên điện thoại (nhãn xuống dòng) để còn chỗ cho các cột vai trò. */
const FIRST_COL =
  'sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-surface px-4 sm:w-64 sm:min-w-64 sm:max-w-64';

const SCOPES: { value: PermissionScope; label: string }[] = [
  { value: 'PROJECT', label: 'Cấp dự án' },
  { value: 'WORKSPACE', label: 'Cấp không gian làm việc' },
];

/** Hai vai trò dự án cũ (chung chung) — vẫn chọn thêm được nhưng không đưa vào bảng mặc định. */
const LEGACY_DEFAULT_OFF = new Set<string>([
  SYSTEM_ROLES.PROJECT_DEVELOPER,
  SYSTEM_ROLES.PROJECT_REPORTER,
]);

/**
 * Bảng so sánh vai trò: hàng = quyền (nhóm theo chức năng), cột = vai trò đang chọn, ô ✓/–.
 * Mặc định hiện các vai trò hệ thống của phạm vi đang xem — chính là các vai "người mới chưa biết làm được gì".
 * Không cần API mới: `useRoles()` đã trả `permissionKeys` cho mọi vai trò.
 */
export function RoleMatrixTable({ roles }: { roles: RoleDto[] }) {
  const [scope, setScope] = useState<PermissionScope>('PROJECT');
  const [onlyDiff, setOnlyDiff] = useState(false);
  // Lựa chọn cột theo từng phạm vi; null = dùng mặc định (vai trò hệ thống của phạm vi đó).
  const [picked, setPicked] = useState<Record<PermissionScope, string[] | null>>({
    PROJECT: null,
    WORKSPACE: null,
  });
  const captionId = useId();

  const scoped = useMemo(
    () =>
      roles
        .filter((r) => r.scope === scope)
        // Vai trò hệ thống trước, rồi theo tên hiển thị tiếng Việt — thứ tự cột ổn định giữa các lần mở.
        .sort(
          (a, b) =>
            Number(b.isSystem) - Number(a.isSystem) ||
            roleLabel(a.name).localeCompare(roleLabel(b.name), 'vi'),
        ),
    [roles, scope],
  );
  const selectedIds = useMemo(
    () =>
      picked[scope] ??
      scoped.filter((r) => r.isSystem && !LEGACY_DEFAULT_OFF.has(r.name)).map((r) => r.id),
    [picked, scope, scoped],
  );
  const columns = scoped.filter((r) => selectedIds.includes(r.id));
  const matrix = useMemo(
    () => buildRoleMatrix(columns, PERMISSION_CATALOG, { scope, onlyDiff }),
    [columns, scope, onlyDiff],
  );

  function toggle(id: string) {
    setPicked((p) => ({
      ...p,
      [scope]: selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    }));
  }

  return (
    <section aria-labelledby={captionId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Phạm vi quyền" className="flex gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={scope === s.value}
              onClick={() => setScope(s.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                scope === s.value
                  ? 'bg-surface-3 text-ink-strong'
                  : 'text-muted hover:bg-surface-2',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <OnlyDiffSwitch checked={onlyDiff} onChange={setOnlyDiff} />
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted">Chọn vai trò để so sánh</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Vai trò để so sánh">
          {scoped.map((r) => {
            const on = selectedIds.includes(r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(r.id)}
                  className={cn(
                    'rounded-full border p-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    on ? 'border-ink/40' : 'border-transparent opacity-50 hover:opacity-100',
                  )}
                >
                  <RoleBadge name={r.name} color={r.color} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          Chọn ít nhất một vai trò ở trên để xem bảng so sánh.
        </p>
      ) : (
        <MatrixGrid matrix={matrix} scope={scope} captionId={captionId} />
      )}
    </section>
  );
}

function OnlyDiffSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Chỉ hiện khác biệt"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          checked ? 'bg-primary' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      Chỉ hiện khác biệt
    </label>
  );
}

/** Bảng ✓/– (cuộn ngang trên màn hẹp, cột "Quyền" dính trái). */
function MatrixGrid({
  matrix,
  scope,
  captionId,
}: {
  matrix: RoleMatrix;
  scope: PermissionScope;
  captionId: string;
}) {
  const columns = matrix.columns;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <caption id={captionId} className="sr-only">
          So sánh quyền giữa các vai trò —{' '}
          {scope === 'PROJECT' ? 'cấp dự án' : 'cấp không gian làm việc'}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={cn(
                FIRST_COL,
                'border-b border-border py-3 text-left text-xs font-medium text-muted',
              )}
            >
              Quyền
            </th>
            {matrix.columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="border-b border-border px-3 py-3 text-center align-bottom font-normal"
              >
                <div className="flex flex-col items-center gap-1">
                  <RoleBadge name={c.name} color={c.color} />
                  <span className="text-xs text-faint" title={`${c.memberCount ?? 0} thành viên`}>
                    {c.memberCount ?? 0}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-sm text-muted">
                Các vai trò đang chọn có quyền giống hệt nhau.
              </td>
            </tr>
          )}
          {matrix.rows.map((row, i) => (
            <Fragment key={row.key}>
              {matrix.rows[i - 1]?.group !== row.group && (
                <tr>
                  {/* Nhãn nhóm nằm trong ô dính trái (ô tràn cả bảng thì nhãn trôi mất khi cuộn ngang). */}
                  <th
                    scope="rowgroup"
                    className="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-b border-border bg-surface-2 px-4 py-1.5 text-left text-xs font-semibold text-ink sm:w-64 sm:min-w-64 sm:max-w-64"
                  >
                    {row.group}
                  </th>
                  <td colSpan={columns.length} className="border-b border-border bg-surface-2" />
                </tr>
              )}
              <tr>
                <th
                  scope="row"
                  className={cn(
                    FIRST_COL,
                    'border-b border-border py-2 text-left font-normal text-ink',
                  )}
                >
                  {row.label}
                </th>
                {row.cells.map((has, ci) => (
                  <td
                    key={matrix.columns[ci]!.id}
                    className="border-b border-border px-3 py-2 text-center"
                  >
                    <span
                      role="img"
                      aria-label={has ? 'có' : 'không'}
                      className={cn('inline-flex', has ? 'text-success' : 'text-faint')}
                    >
                      {has ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : (
                        <Minus className="h-4 w-4" aria-hidden />
                      )}
                    </span>
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
