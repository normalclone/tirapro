import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Shield, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  PERMISSION_CATALOG,
  type PermissionKey,
  type PermissionScope,
  type RoleDto,
  type RoleScope,
} from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import {
  useCreateRole,
  useDeleteRole,
  useRoles,
  useUpdateRole,
  type CreateRoleInput,
} from '@/features/roles/api';

/** Bộ màu OKLCH gợi ý cho vai trò tuỳ chỉnh (đồng bộ tông với system role). */
const PRESET_COLORS = [
  'oklch(0.55 0.20 25)',
  'oklch(0.58 0.16 330)',
  'oklch(0.55 0.16 300)',
  'oklch(0.55 0.13 245)',
  'oklch(0.60 0.13 200)',
  'oklch(0.58 0.13 150)',
  'oklch(0.72 0.15 75)',
  'oklch(0.60 0.018 256)',
];

const SCOPE_LABEL: Record<RoleScope, string> = {
  WORKSPACE: 'Cấp workspace',
  PROJECT: 'Cấp dự án',
};

/** Sắp xếp: system role trước, rồi theo tên. */
function sortRoles(roles: RoleDto[]): RoleDto[] {
  return [...roles].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return a.name.localeCompare(b.name, 'vi');
  });
}

export function RolesPage() {
  const can = useAuth((s) => s.can);
  const canManage = can('member:manage');
  const { data: roles, isLoading } = useRoles();

  const [editing, setEditing] = useState<RoleDto | null>(null);
  const [creatingScope, setCreatingScope] = useState<RoleScope | null>(null);

  const grouped = useMemo(() => {
    const all = roles ?? [];
    return {
      WORKSPACE: sortRoles(all.filter((r) => r.scope === 'WORKSPACE')),
      PROJECT: sortRoles(all.filter((r) => r.scope === 'PROJECT')),
    };
  }, [roles]);

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Vai trò</h1>
          <p className="mt-1 text-sm text-muted">
            Vai trò gom các quyền lại để gán cho thành viên. Vai trò hệ thống là cố định; bạn
            có thể tạo vai trò tuỳ chỉnh riêng.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreatingScope('WORKSPACE')}>
            <Plus className="h-4 w-4" />
            Tạo vai trò
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !roles || roles.length === 0 ? (
        <EmptyState
          icon={<Shield className="h-6 w-6" />}
          title="Chưa có vai trò"
          description="Tạo vai trò đầu tiên để phân quyền cho thành viên."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setCreatingScope('WORKSPACE')}>
                <Plus className="h-4 w-4" />
                Tạo vai trò
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {(['WORKSPACE', 'PROJECT'] as const).map((scope) => (
            <RoleGroup
              key={scope}
              scope={scope}
              roles={grouped[scope]}
              canManage={canManage}
              onOpen={(r) => setEditing(r)}
              onCreate={() => setCreatingScope(scope)}
            />
          ))}
        </div>
      )}

      {(editing || creatingScope) && (
        <RoleDialog
          role={editing}
          initialScope={creatingScope ?? 'WORKSPACE'}
          canManage={canManage}
          onClose={() => {
            setEditing(null);
            setCreatingScope(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nhóm vai trò theo scope                                             */
/* ------------------------------------------------------------------ */

function RoleGroup({
  scope,
  roles,
  canManage,
  onOpen,
  onCreate,
}: {
  scope: RoleScope;
  roles: RoleDto[];
  canManage: boolean;
  onOpen: (role: RoleDto) => void;
  onCreate: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-ink-strong">{SCOPE_LABEL[scope]}</h2>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            Tạo vai trò
          </Button>
        )}
      </div>
      <div className="p-2">
        {roles.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">Chưa có vai trò {SCOPE_LABEL[scope].toLowerCase()}.</p>
        ) : (
          <ul className="space-y-0.5">
            {roles.map((role) => (
              <li key={role.id}>
                <RoleRow role={role} onOpen={() => onOpen(role)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RoleRow({ role, onOpen }: { role: RoleDto; onOpen: () => void }) {
  const memberCount = role.memberCount ?? 0;
  const permCount = role.permissionKeys.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
      )}
    >
      <RoleBadge name={role.name} color={role.color} />
      {role.isSystem && (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-faint">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Hệ thống
        </span>
      )}
      {role.description && (
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{role.description}</span>
      )}
      <span className={cn('ml-auto shrink-0 text-xs text-faint', role.description && 'ml-3')}>
        {memberCount} thành viên · {permCount} quyền
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog tạo / sửa / xem vai trò                                      */
/* ------------------------------------------------------------------ */

/** Quyền nhóm theo scope, để dựng checklist. */
const PERMS_BY_SCOPE: Record<PermissionScope, typeof PERMISSION_CATALOG> = {
  WORKSPACE: PERMISSION_CATALOG.filter((p) => p.scope === 'WORKSPACE'),
  PROJECT: PERMISSION_CATALOG.filter((p) => p.scope === 'PROJECT'),
};

const PERM_SCOPE_LABEL: Record<PermissionScope, string> = {
  WORKSPACE: 'Quyền cấp workspace',
  PROJECT: 'Quyền cấp dự án',
};

function RoleDialog({
  role,
  initialScope,
  canManage,
  onClose,
}: {
  role: RoleDto | null;
  initialScope: RoleScope;
  canManage: boolean;
  onClose: () => void;
}) {
  const isCreate = role === null;
  const readOnly = !canManage || (role?.isSystem ?? false);

  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();

  const [name, setName] = useState(role?.name ?? '');
  const [scope, setScope] = useState<RoleScope>(role?.scope ?? initialScope);
  const [description, setDescription] = useState(role?.description ?? '');
  const [color, setColor] = useState<string>(role?.color ?? PRESET_COLORS[3]);
  const [perms, setPerms] = useState<Set<PermissionKey>>(
    () => new Set(role?.permissionKeys ?? []),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Checklist hiển thị theo scope của vai trò (workspace ↔ project). Khi đổi scope
  // lúc tạo mới, loại bỏ các quyền không còn thuộc scope đó.
  const visibleScopes: PermissionScope[] =
    scope === 'WORKSPACE' ? ['WORKSPACE'] : ['PROJECT'];

  function setScopeAndPrune(next: RoleScope) {
    setScope(next);
    const allowed = new Set(PERMS_BY_SCOPE[next].map((p) => p.key));
    setPerms((prev) => new Set([...prev].filter((k) => allowed.has(k))));
  }

  function togglePerm(key: PermissionKey) {
    if (readOnly) return;
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const trimmedName = name.trim();
  const permKeys = [...perms];
  const canSubmit = trimmedName.length > 0 && permKeys.length > 0 && !readOnly;
  const busy = createRole.isPending || updateRole.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    if (isCreate) {
      const body: CreateRoleInput = {
        name: trimmedName,
        scope,
        description: description.trim() || null,
        color,
        permissionKeys: permKeys,
      };
      createRole.mutate(body, { onSuccess: onClose });
    } else {
      updateRole.mutate(
        {
          id: role.id,
          patch: {
            name: trimmedName,
            description: description.trim() || null,
            color,
            permissionKeys: permKeys,
          },
        },
        { onSuccess: onClose },
      );
    }
  }

  function handleDelete() {
    if (!role || role.isSystem) return;
    const count = role.memberCount ?? 0;
    const warn =
      count > 0
        ? `Vai trò "${role.name}" đang gán cho ${count} thành viên. Xoá vai trò?`
        : `Xoá vai trò "${role.name}"? Hành động này không thể hoàn tác.`;
    if (!window.confirm(warn)) return;
    deleteRole.mutate(role.id, { onSuccess: onClose });
  }

  const title = isCreate ? 'Tạo vai trò' : readOnly ? role?.name : `Sửa "${role?.name}"`;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[84vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          {readOnly ? (
            <RoleBadge name={role?.name ?? ''} color={role?.color} />
          ) : (
            <Shield className="h-4 w-4 text-primary" />
          )}
          <span className="text-sm font-medium text-ink">{!readOnly && title}</span>
          {readOnly && !isCreate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-faint">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              Chỉ xem
            </span>
          )}
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {!readOnly && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="role-name" className="mb-1.5 block text-sm font-medium text-muted">
                      Tên vai trò
                    </label>
                    <Input
                      id="role-name"
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="VD: QA Lead"
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="role-scope" className="mb-1.5 block text-sm font-medium text-muted">
                      Phạm vi
                    </label>
                    <select
                      id="role-scope"
                      value={scope}
                      disabled={!isCreate}
                      onChange={(e) => setScopeAndPrune(e.target.value as RoleScope)}
                      className={cn(
                        'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-ink',
                        'transition-colors focus-visible:outline-none focus-visible:border-primary',
                        'focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
                      )}
                    >
                      <option value="WORKSPACE">Workspace</option>
                      <option value="PROJECT">Dự án</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="role-desc" className="mb-1.5 block text-sm font-medium text-muted">
                    Mô tả <span className="font-normal text-faint">(tuỳ chọn)</span>
                  </label>
                  <Input
                    id="role-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Vai trò này dùng để làm gì?"
                    className="text-sm"
                  />
                </div>

                <div>
                  <span className="mb-1.5 block text-sm font-medium text-muted">Màu</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESET_COLORS.map((c) => {
                      const active = c === color;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          aria-label={`Chọn màu ${c}`}
                          aria-pressed={active}
                          className={cn(
                            'h-7 w-7 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                            active ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110',
                          )}
                          style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }}
                        />
                      );
                    })}
                    <span className="ml-1">
                      <RoleBadge name={trimmedName || 'Xem trước'} color={color} />
                    </span>
                  </div>
                </div>
              </>
            )}

            {readOnly && role?.description && (
              <p className="text-sm text-muted">{role.description}</p>
            )}

            {/* Checklist quyền */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-strong">Quyền</span>
                <span className="text-xs text-faint">{permKeys.length} quyền được chọn</span>
              </div>
              {visibleScopes.map((ps) => (
                <fieldset key={ps} className="space-y-1">
                  <legend className="mb-1 text-xs font-medium text-faint">
                    {PERM_SCOPE_LABEL[ps]}
                  </legend>
                  <div className="space-y-0.5">
                    {PERMS_BY_SCOPE[ps].map((p) => {
                      const checked = perms.has(p.key);
                      return (
                        <label
                          key={p.key}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                            readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={readOnly}
                            onChange={() => togglePerm(p.key)}
                            className="h-4 w-4 shrink-0 rounded border-border-strong text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60"
                          />
                          <span className={cn('min-w-0 flex-1', checked ? 'text-ink' : 'text-muted')}>
                            {p.description}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-faint">{p.key}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>

          <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
            {!readOnly && !isCreate && role && !role.isSystem && (
              <Button
                type="button"
                variant="ghost"
                className="text-danger hover:bg-danger/10"
                onClick={handleDelete}
                loading={deleteRole.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Xoá
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {readOnly ? 'Đóng' : 'Huỷ'}
              </Button>
              {!readOnly && (
                <Button type="submit" loading={busy} disabled={!canSubmit}>
                  {isCreate ? 'Tạo vai trò' : 'Lưu'}
                </Button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
