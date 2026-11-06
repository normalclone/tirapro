import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import type { PermissionKey } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { useRetained } from '@/lib/useRetained';
import { cn } from '@/lib/utils';
import { useCan } from '@/features/projects/permissions';
import { useRoles } from '@/features/roles/api';
import {
  useCreateProjectRole,
  useDeleteProjectRole,
  useProjectRoles,
  useUpdateProjectRole,
  type ProjectRoleDto,
} from '@/features/roles/projectRolesApi';
import {
  PROJECT_ROLE_PERMISSIONS,
  canCreateProjectRole,
  createProjectRoleBody,
  roleUsageText,
  suggestedRoleName,
  type RoleCreateMode,
} from './projectRoleForm';

/**
 * Cấu hình dự án › Vai trò: vai trò RIÊNG của dự án này. Project Admin tạo "từ mẫu" (Quản trị định nghĩa mẫu ở Quản trị › Vai trò
 * & quyền) hoặc tự tick quyền cấp dự án, đổi tên, sửa quyền, xoá (đang có người giữ → máy chủ trả 422 kèm số người).
 */
export function ProjectRolesSection({ projectId }: { projectId?: string }) {
  const canAdmin = useCan(projectId)('project:admin');
  const rolesQuery = useProjectRoles(projectId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectRoleDto | null>(null);
  const [session, setSession] = useState(0);
  const dialogOpen = creating || editing !== null;
  const target = useRetained(dialogOpen ? { role: editing } : null);
  const del = useDeleteProjectRole(projectId ?? '');
  const confirm = useConfirm();

  function open(role: ProjectRoleDto | null) {
    setSession((n) => n + 1);
    if (role) setEditing(role);
    else setCreating(true);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }
  async function remove(r: ProjectRoleDto) {
    const ok = await confirm({
      title: `Xoá vai trò "${r.name}"?`,
      description:
        r.memberCount > 0
          ? `Vai trò đang gán cho ${r.memberCount} người — gỡ khỏi họ trước, nếu không sẽ không xoá được.`
          : 'Hành động này không thể hoàn tác.',
      confirmLabel: 'Xoá vai trò',
      destructive: true,
    });
    if (ok) del.mutate(r.id);
  }

  return (
    <SectionCard
      title="Vai trò của dự án"
      description="Vai trò chỉ dùng trong dự án này. Tạo nhanh từ mẫu của tổ chức rồi chỉnh quyền, hoặc tự chọn quyền."
      actions={
        canAdmin ? (
          <Button size="sm" onClick={() => open(null)} data-tour="project-roles-create">
            <Plus className="h-4 w-4" />
            Tạo vai trò
          </Button>
        ) : undefined
      }
    >
      <QueryBoundary
        query={rolesQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <EmptyState
            icon={<Shield className="h-6 w-6" />}
            title="Dự án chưa có vai trò nào"
            description="Cần có vai trò để thêm người vào dự án. Tạo từ mẫu (ví dụ Developer, Tester) là nhanh nhất."
            action={
              canAdmin ? (
                <Button variant="secondary" size="sm" onClick={() => open(null)}>
                  <Plus className="h-4 w-4" />
                  Tạo vai trò từ mẫu
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(roles) => (
          <ul className="divide-y divide-border">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <RoleBadge name={r.name} color={r.color} />
                  <p className="mt-1 text-xs text-faint">
                    {r.permissionKeys.length} quyền · {roleUsageText(r.memberCount)}
                  </p>
                </div>
                {canAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Sửa tên và quyền"
                      aria-label={`Sửa vai trò ${r.name}`}
                      onClick={() => open(r)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá vai trò"
                      aria-label={`Xoá vai trò ${r.name}`}
                      onClick={() => void remove(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
      <ProjectRoleDialog
        key={session}
        projectId={projectId ?? ''}
        open={dialogOpen}
        role={target?.role ?? null}
        onClose={close}
      />
    </SectionCard>
  );
}

function ProjectRoleDialog({
  projectId,
  open,
  role,
  onClose,
}: {
  projectId: string;
  open: boolean;
  role: ProjectRoleDto | null;
  onClose: () => void;
}) {
  const isCreate = role === null;
  const create = useCreateProjectRole(projectId);
  const update = useUpdateProjectRole(projectId);
  const { data: templates } = useRoles('PROJECT');
  const [mode, setMode] = useState<RoleCreateMode>('template');
  const [name, setName] = useState(role?.name ?? '');
  const [templateId, setTemplateId] = useState('');
  const [perms, setPerms] = useState<ReadonlySet<PermissionKey>>(
    () => new Set(role?.permissionKeys ?? []),
  );
  const busy = create.isPending || update.isPending;
  const editName = name.trim();
  const canSubmit = isCreate
    ? canCreateProjectRole({ mode, name, templateId, perms })
    : editName.length > 0 && perms.size > 0;

  function togglePerm(key: PermissionKey) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function pickTemplate(id: string) {
    setTemplateId(id);
    const tpl = (templates ?? []).find((t) => t.id === id);
    // Điền sẵn tên mẫu (sửa được) nếu người dùng chưa gõ gì.
    if (tpl && name.trim() === '') setName(suggestedRoleName(tpl.name));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    if (isCreate) {
      create.mutate(createProjectRoleBody({ mode, name, templateId, perms }), {
        onSuccess: onClose,
      });
    } else {
      update.mutate(
        { id: role.id, patch: { name: editName, permissionKeys: [...perms] } },
        { onSuccess: onClose },
      );
    }
  }

  const showPerms = !isCreate || mode === 'custom';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={isCreate ? 'Tạo vai trò của dự án' : `Sửa "${role.name}"`}
      icon={<Shield className="h-4 w-4" />}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="project-role-form" loading={busy} disabled={!canSubmit}>
            {isCreate ? 'Tạo vai trò' : 'Lưu'}
          </Button>
        </>
      }
    >
      <form id="project-role-form" onSubmit={submit} className="space-y-5">
        {isCreate && (
          <div>
            <span id="prole-mode-label" className="mb-1.5 block text-sm font-medium text-muted">
              Cách tạo
            </span>
            <SegmentedControl<RoleCreateMode>
              ariaLabelledby="prole-mode-label"
              value={mode}
              onChange={setMode}
              fullWidth
              options={[
                { value: 'template', label: 'Từ mẫu' },
                { value: 'custom', label: 'Tự chọn quyền' },
              ]}
            />
          </div>
        )}
        {isCreate && mode === 'template' && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-muted">Mẫu vai trò</span>
            <SearchSelect
              value={templateId}
              onChange={pickTemplate}
              options={(templates ?? []).map((t) => ({
                value: t.id,
                label: t.name,
                color: t.color,
                hint: `${t.permissionKeys.length} quyền`,
              }))}
              placeholder="Chọn một mẫu…"
              searchPlaceholder="Tìm mẫu…"
              ariaLabel="Mẫu vai trò"
              className="text-sm"
            />
            <p className="mt-1.5 text-xs text-faint">
              Sao chép tên và quyền của mẫu; sau khi tạo bạn vẫn sửa quyền tự do.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="prole-name" className="mb-1.5 block text-sm font-medium text-muted">
            Tên vai trò
            {isCreate && mode === 'template' && (
              <span className="font-normal text-faint"> (để trống = lấy tên mẫu)</span>
            )}
          </label>
          <Input
            id="prole-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: QA Lead"
            className="text-sm"
            autoFocus={!isCreate || mode === 'custom'}
          />
        </div>
        {showPerms && <PermissionChecklist perms={perms} onToggle={togglePerm} />}
      </form>
    </Dialog>
  );
}

/** Checklist quyền cấp dự án (chỉ quyền trong catalog thuộc cấp dự án). */
function PermissionChecklist({
  perms,
  onToggle,
}: {
  perms: ReadonlySet<PermissionKey>;
  onToggle: (key: PermissionKey) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium text-ink-strong">
        <span>Quyền trong dự án</span>
        <span className="text-xs font-normal text-faint">{perms.size} quyền được chọn</span>
      </legend>
      <div className="space-y-0.5">
        {PROJECT_ROLE_PERMISSIONS.map((p) => {
          const checked = perms.has(p.key);
          return (
            <label
              key={p.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(p.key)}
                className="h-4 w-4 shrink-0 rounded border-border-strong text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
  );
}
