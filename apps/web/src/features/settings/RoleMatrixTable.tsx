import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useIsMutating, type UseQueryResult } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import {
  PERMISSION_CATALOG,
  type MemberDto,
  type PermissionScope,
  type RoleDto,
} from '@tirapro/types';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { Button } from '@/components/ui/Button';
import { useWorkspaceMembers } from '@/features/members/api';
import { cn } from '@/lib/utils';
import {
  buildGroupedMatrix,
  buildRoleMatrix,
  defaultColumnIds,
  sortMatrixRoles,
} from './roleMatrix';
import { SYSTEM_LOCK_REASON } from './RoleMatrixCells';
import { MatrixGrid } from './RoleMatrixGrid';
import { useRolePermEditor } from './useRolePermEditor';

const SCOPES: { value: PermissionScope; label: string }[] = [
  { value: 'PROJECT', label: 'Cấp dự án' },
  { value: 'WORKSPACE', label: 'Cấp không gian làm việc' },
];

type Picked = Record<PermissionScope, string[] | null>;

/**
 * Bảng so sánh VÀ chỉnh quyền vai trò: hàng = quyền (nhóm theo chức năng), cột = vai trò đang chọn.
 * - Chỉ đọc (không có `member:manage`, hoặc chưa tải xong danh sách thành viên để kiểm chốt): ô ✓/–.
 * - Chỉnh được: ô của vai trò TUỲ CHỈNH là nút bật/tắt (lưu tự động, gom bấm ~500 ms, có Hoàn tác); ô của vai trò HỆ THỐNG
 *   khoá + nút "Nhân bản vai trò". Chế độ "Gộp theo nhóm": ô nhóm 3 trạng thái, bấm cả nhóm.
 * Mặc định hiện các vai trò hệ thống của phạm vi đang xem — chính là các vai "người mới chưa biết làm được gì"
 * (người sửa được thấy thêm các vai trò tuỳ chỉnh).
 */
export function RoleMatrixTable({
  roles,
  canEdit = false,
  onClone,
  revealRoleId,
  onRevealed,
}: {
  roles: RoleDto[];
  /** Có `member:manage` (người gọi tính bằng selector boolean). */
  canEdit?: boolean;
  /** Mở hộp "Nhân bản vai trò" cho vai trò này. */
  onClone?: (role: RoleDto) => void;
  /** Vai trò vừa tạo (nhân bản): tự thêm vào bảng để sửa ngay. */
  revealRoleId?: string | null;
  onRevealed?: () => void;
}) {
  const [scope, setScope] = useState<PermissionScope>('PROJECT');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Lựa chọn cột theo từng phạm vi; null = dùng mặc định.
  const [picked, setPicked] = useState<Picked>({ PROJECT: null, WORKSPACE: null });
  const captionId = useId();
  const lockNoteId = useId();

  const members = useWorkspaceMembers(canEdit);
  // Chỉ cho sửa khi đã có danh sách thành viên: chốt "quản trị cuối cùng" và "tự mất quyền" cần nó.
  const editable = canEdit && members.isSuccess;
  const editor = useRolePermEditor({ roles, members: members.data });
  const saving =
    useIsMutating({ mutationKey: ['role-perms'] }) > 0 || Object.keys(editor.pending).length > 0;

  const scoped = useMemo(
    () =>
      sortMatrixRoles(
        roles.filter((r) => r.scope === scope),
        canEdit,
      ),
    [roles, scope, canEdit],
  );
  const selectedIds = useMemo(
    () => picked[scope] ?? defaultColumnIds(scoped, scope, canEdit),
    [picked, scope, scoped, canEdit],
  );
  const columns = useMemo(
    () => scoped.filter((r) => selectedIds.includes(r.id)),
    [scoped, selectedIds],
  );
  const matrix = useMemo(
    () => buildRoleMatrix(columns, PERMISSION_CATALOG, { scope, onlyDiff }),
    [columns, scope, onlyDiff],
  );
  const groupedMatrix = useMemo(
    () => buildGroupedMatrix(columns, PERMISSION_CATALOG, { scope, onlyDiff }),
    [columns, scope, onlyDiff],
  );

  useRevealRole({ revealRoleId, roles, picked, canEdit, setPicked, setScope, onRevealed });

  function toggleColumn(id: string) {
    setPicked((p) => ({
      ...p,
      [scope]: selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    }));
  }
  function toggleExpanded(group: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <section aria-labelledby={captionId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeButtons scope={scope} onChange={setScope} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span role="status" aria-live="polite" className="text-xs text-faint">
            {editable && saving ? 'Đang lưu…' : ''}
          </span>
          <InlineSwitch label="Gộp theo nhóm" checked={grouped} onChange={setGrouped} />
          <InlineSwitch label="Chỉ hiện khác biệt" checked={onlyDiff} onChange={setOnlyDiff} />
        </div>
      </div>

      <EditNotes
        canEdit={canEdit}
        members={members}
        lockNoteId={lockNoteId}
        showLock={columns.some((c) => c.isSystem)}
      />

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
                  onClick={() => toggleColumn(r.id)}
                  className={cn(
                    'rounded-full border p-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-1',
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
        <MatrixGrid
          matrix={matrix}
          groupedMatrix={groupedMatrix}
          grouped={grouped}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          scope={scope}
          captionId={captionId}
          lockNoteId={lockNoteId}
          editable={editable}
          pending={editor.pending}
          onToggle={(role, key) => void editor.toggle(role, key)}
          onToggleGroup={(role, keys) => void editor.toggleGroup(role, keys)}
          onClone={canEdit ? onClone : undefined}
        />
      )}
    </section>
  );
}

/** Vai trò vừa nhân bản: chuyển sang đúng phạm vi và thêm cột để sửa ngay. */
function useRevealRole(a: {
  revealRoleId?: string | null;
  roles: RoleDto[];
  picked: Picked;
  canEdit: boolean;
  setPicked: (f: (p: Picked) => Picked) => void;
  setScope: (s: PermissionScope) => void;
  onRevealed?: () => void;
}) {
  const { revealRoleId, roles, picked, canEdit, setPicked, setScope, onRevealed } = a;
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!revealRoleId || revealed.current === revealRoleId) return;
    const r = roles.find((x) => x.id === revealRoleId);
    if (!r) return; // danh sách chưa nạp lại — thử lại khi `roles` đổi
    revealed.current = revealRoleId;
    const base = picked[r.scope] ?? defaultColumnIds(roles, r.scope, canEdit);
    setPicked((p) => ({ ...p, [r.scope]: base.includes(r.id) ? base : [...base, r.id] }));
    setScope(r.scope);
    onRevealed?.();
  }, [revealRoleId, roles, picked, canEdit, setPicked, setScope, onRevealed]);
}

function ScopeButtons({
  scope,
  onChange,
}: {
  scope: PermissionScope;
  onChange: (s: PermissionScope) => void;
}) {
  return (
    <div role="group" aria-label="Phạm vi quyền" className="flex gap-1">
      {SCOPES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={scope === s.value}
          onClick={() => onChange(s.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11',
            scope === s.value ? 'bg-surface-3 text-ink-strong' : 'text-muted hover:bg-surface-2',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** Ghi chú cho người sửa được: đang tải/lỗi tải thành viên (chưa sửa được), hướng dẫn bấm ô, lý do khoá vai trò hệ thống. */
function EditNotes({
  canEdit,
  members,
  lockNoteId,
  showLock,
}: {
  canEdit: boolean;
  members: UseQueryResult<MemberDto[]>;
  lockNoteId: string;
  showLock: boolean;
}) {
  if (!canEdit) return null;
  if (!members.isSuccess) {
    return (
      <p className="text-xs text-muted" role={members.isError ? 'alert' : 'status'}>
        {members.isError ? (
          <>
            Chưa thể sửa quyền: không tải được danh sách thành viên để kiểm tra quyền thiết yếu.{' '}
            <Button variant="ghost" size="sm" onClick={() => void members.refetch()}>
              Thử lại
            </Button>
          </>
        ) : (
          'Đang tải danh sách thành viên để kiểm tra quyền thiết yếu…'
        )}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted">
      Bấm một ô của vai trò tuỳ chỉnh để bật/tắt quyền — lưu tự động và có hiệu lực ngay.
      {showLock && (
        <>
          {' '}
          <span id={lockNoteId} className="inline-flex items-center gap-1 text-faint">
            <Lock className="h-3 w-3" aria-hidden />
            {SYSTEM_LOCK_REASON}.
          </span>
        </>
      )}
    </p>
  );
}

function InlineSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
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
      {label}
    </label>
  );
}
