import {
  Fragment,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Lock, Minus } from 'lucide-react';
import { roleLabel, type PermissionScope, type RoleDto } from '@tirapro/types';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { cn } from '@/lib/utils';
import type { GroupedMatrix, MatrixGroup, MatrixRow, RoleMatrix } from './roleMatrix';
import { nextCell, type CellPos } from './matrixNav';
import { GroupCell, PermCell } from './RoleMatrixCells';
import { groupState, hasKey, type Desired, type GroupState } from './rolePermEdit';

/** Cột "Quyền": dính trái, hẹp trên điện thoại (nhãn xuống dòng) để còn chỗ cho các cột vai trò. */
const FIRST_COL =
  'sticky left-0 z-10 w-40 min-w-40 max-w-40 bg-surface px-4 sm:w-64 sm:min-w-64 sm:max-w-64';

/** Ô chỉ đọc (không phải nút): ✓ / –. */
function ReadonlyCell({ has }: { has: boolean }) {
  return (
    <span
      role="img"
      aria-label={has ? 'có' : 'không'}
      className={cn('inline-flex', has ? 'text-success' : 'text-faint')}
    >
      {has ? <Check className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
    </span>
  );
}

function ReadonlyGroupCell({ g }: { g: GroupState }) {
  const text = g.state === 'full' ? 'đủ' : g.state === 'partial' ? 'một phần' : 'không';
  return (
    <span
      role="img"
      aria-label={`${text}, ${g.count}/${g.total}`}
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        g.state === 'none' ? 'text-faint' : 'text-success',
      )}
    >
      {g.state === 'full' ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Minus className="h-4 w-4" aria-hidden />
      )}
      <span className="tabular-nums" aria-hidden>
        {g.count}/{g.total}
      </span>
    </span>
  );
}

/** Một dòng của lưới (để đánh số dòng cho điều hướng bàn phím). */
type GridRow =
  | { kind: 'perm'; row: MatrixRow; indent: boolean }
  | { kind: 'group'; group: MatrixGroup };

const groupOfRow = (gr: GridRow) => (gr.kind === 'group' ? gr.group.group : gr.row.group);

/** Mọi thứ một dòng cần để vẽ ô. */
interface RowEnv {
  columns: RoleDto[];
  editable: boolean;
  lockNoteId: string;
  has: (role: RoleDto, key: string) => boolean;
  cellPos: (r: number, c: number) => { pos: CellPos; tabIndex: 0 | -1 };
  onToggle: (role: RoleDto, key: string) => void;
  onToggleGroup: (role: RoleDto, keys: readonly string[]) => void;
}

function GridHead({
  columns,
  editable,
  onClone,
}: {
  columns: RoleDto[];
  editable: boolean;
  onClone?: (role: RoleDto) => void;
}) {
  return (
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
        {columns.map((c) => (
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
              {editable && c.isSystem && (
                <span className="inline-flex items-center gap-1 text-xs text-faint">
                  <Lock className="h-3 w-3" aria-hidden />
                  Khoá
                </span>
              )}
              {onClone && (
                <button
                  type="button"
                  onClick={() => onClone(c)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2"
                >
                  <Copy className="h-3 w-3" aria-hidden />
                  Nhân bản<span className="sr-only"> vai trò {roleLabel(c.name)}</span>
                </button>
              )}
            </div>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function GroupRowView({
  index,
  group,
  open,
  onToggleOpen,
  env,
}: {
  index: number;
  group: MatrixGroup;
  open: boolean;
  onToggleOpen: () => void;
  env: RowEnv;
}) {
  return (
    <tr>
      <th
        scope="row"
        className={cn(
          FIRST_COL,
          'border-b border-border bg-surface-2 py-1 text-left font-normal text-ink',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggleOpen}
          className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          {group.group}
          <span className="font-normal text-faint">({group.keys.length})</span>
        </button>
      </th>
      {env.columns.map((role, ci) => {
        const g = groupState(group.keys, (k) => env.has(role, k));
        return (
          <td key={role.id} className="border-b border-border bg-surface-2 px-3 py-2 text-center">
            {env.editable ? (
              <GroupCell
                g={g}
                label={`${group.group} — ${roleLabel(role.name)}, ${g.count}/${g.total} quyền`}
                locked={role.isSystem}
                describedBy={env.lockNoteId}
                onToggle={() => env.onToggleGroup(role, group.keys)}
                {...env.cellPos(index, ci)}
              />
            ) : (
              <ReadonlyGroupCell g={g} />
            )}
          </td>
        );
      })}
    </tr>
  );
}

function PermRowView({
  index,
  row,
  indent,
  env,
}: {
  index: number;
  row: MatrixRow;
  indent: boolean;
  env: RowEnv;
}) {
  return (
    <tr>
      <th
        scope="row"
        className={cn(
          FIRST_COL,
          'border-b border-border py-2 text-left font-normal text-ink',
          indent && 'pl-8',
        )}
      >
        {row.label}
      </th>
      {env.columns.map((role, ci) => (
        <td key={role.id} className="border-b border-border px-3 py-2 text-center">
          {env.editable ? (
            <PermCell
              on={env.has(role, row.key)}
              label={`${row.label} — ${roleLabel(role.name)}`}
              locked={role.isSystem}
              describedBy={env.lockNoteId}
              onToggle={() => env.onToggle(role, row.key)}
              {...env.cellPos(index, ci)}
            />
          ) : (
            <ReadonlyCell has={env.has(role, row.key)} />
          )}
        </td>
      ))}
    </tr>
  );
}

/** Điều hướng mũi tên giữa các ô (roving tabindex): trả vị trí đang là điểm dừng Tab + hai handler cho `<tbody>`. */
function useGridNav(tableRef: RefObject<HTMLTableElement>, size: { rows: number; cols: number }) {
  const [active, setActive] = useState<CellPos>({ r: 0, c: 0 });
  const cellOf = (e: { target: EventTarget }) => {
    const t = e.target as HTMLElement;
    return t.dataset.r === undefined || t.dataset.c === undefined
      ? null
      : { r: Number(t.dataset.r), c: Number(t.dataset.c) };
  };
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const from = cellOf(e);
    if (!from) return;
    const to = nextCell(from, e.key, size, e.ctrlKey || e.metaKey);
    if (!to) return;
    e.preventDefault();
    setActive(to);
    tableRef.current?.querySelector<HTMLElement>(`[data-r="${to.r}"][data-c="${to.c}"]`)?.focus();
  }
  function onFocus(e: FocusEvent<HTMLTableSectionElement>) {
    const next = cellOf(e);
    if (next && (next.r !== active.r || next.c !== active.c)) setActive(next);
  }
  return { active, onKeyDown, onFocus };
}

/** Bảng ✓/– hoặc nút bật/tắt (cuộn ngang trên màn hẹp, cột "Quyền" dính trái). */
export function MatrixGrid({
  matrix,
  groupedMatrix,
  grouped,
  expanded,
  onToggleExpanded,
  scope,
  captionId,
  lockNoteId,
  editable,
  pending,
  onToggle,
  onToggleGroup,
  onClone,
}: {
  matrix: RoleMatrix;
  groupedMatrix: GroupedMatrix;
  grouped: boolean;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (group: string) => void;
  scope: PermissionScope;
  captionId: string;
  lockNoteId: string;
  editable: boolean;
  pending: Record<string, Desired>;
  onToggle: (role: RoleDto, key: string) => void;
  onToggleGroup: (role: RoleDto, keys: readonly string[]) => void;
  onClone?: (role: RoleDto) => void;
}) {
  const columns = matrix.columns;
  const tableRef = useRef<HTMLTableElement>(null);

  // Các dòng có ô, theo thứ tự hiển thị.
  const gridRows: GridRow[] = grouped
    ? groupedMatrix.groups.flatMap((g): GridRow[] => [
        { kind: 'group', group: g },
        ...(expanded.has(g.group)
          ? g.rows.map((row): GridRow => ({ kind: 'perm', row, indent: true }))
          : []),
      ])
    : matrix.rows.map((row): GridRow => ({ kind: 'perm', row, indent: false }));

  const nav = useGridNav(tableRef, { rows: gridRows.length, cols: columns.length });
  const env: RowEnv = {
    columns,
    editable,
    lockNoteId,
    has: (role, key) => hasKey(role.permissionKeys, pending[role.id], key),
    cellPos: (r, c) => ({
      pos: { r, c },
      tabIndex: r === nav.active.r && c === nav.active.c ? 0 : -1,
    }),
    onToggle,
    onToggleGroup,
  };

  const empty = grouped ? groupedMatrix.groups.length === 0 : matrix.rows.length === 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table ref={tableRef} className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <caption id={captionId} className="sr-only">
          {editable ? 'Quyền của các vai trò' : 'So sánh quyền giữa các vai trò'} —{' '}
          {scope === 'PROJECT' ? 'cấp dự án' : 'cấp không gian làm việc'}
        </caption>
        <GridHead columns={columns} editable={editable} onClone={onClone} />
        <tbody
          onKeyDown={editable ? nav.onKeyDown : undefined}
          onFocus={editable ? nav.onFocus : undefined}
        >
          {empty && (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-sm text-muted">
                Các vai trò đang chọn có quyền giống hệt nhau.
              </td>
            </tr>
          )}
          {gridRows.map((gr, i) => {
            const prev = gridRows[i - 1];
            return (
              <Fragment key={gr.kind === 'group' ? `g:${gr.group.group}` : gr.row.key}>
                {!grouped && (!prev || groupOfRow(prev) !== groupOfRow(gr)) && (
                  <tr>
                    {/* Nhãn nhóm nằm trong ô dính trái (ô tràn cả bảng thì nhãn trôi mất khi cuộn ngang). */}
                    <th
                      scope="rowgroup"
                      className="sticky left-0 z-10 w-40 min-w-40 max-w-40 border-b border-border bg-surface-2 px-4 py-1.5 text-left text-xs font-semibold text-ink sm:w-64 sm:min-w-64 sm:max-w-64"
                    >
                      {groupOfRow(gr)}
                    </th>
                    <td colSpan={columns.length} className="border-b border-border bg-surface-2" />
                  </tr>
                )}
                {gr.kind === 'group' ? (
                  <GroupRowView
                    index={i}
                    group={gr.group}
                    open={expanded.has(gr.group.group)}
                    onToggleOpen={() => onToggleExpanded(gr.group.group)}
                    env={env}
                  />
                ) : (
                  <PermRowView index={i} row={gr.row} indent={gr.indent} env={env} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
