import { useMemo, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SYSTEM_ROLES } from '@tirapro/types';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { useAddMember, useAllUsers, useWorkspaceMembers } from './api';

/**
 * Thẻ "Thêm thành viên": chọn một người dùng CÓ SẴN từ pool hệ thống (do system admin quản lý
 * ở nơi khác) rồi gán vai trò và thêm vào không gian làm việc.
 * Gated bằng `member:manage` — trùng với cách MembersPage kiểm tra quyền.
 */
export function AddMemberPanel() {
  const can = useAuth((s) => s.can);
  if (!can('member:manage')) return null;
  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <UserPlus className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Thêm thành viên</h2>
          <p className="mt-0.5 text-sm text-muted">
            Chọn người dùng có sẵn trong hệ thống và gán vai trò.
          </p>
        </div>
      </div>
      <AddExistingUser />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Chọn người dùng có sẵn                                              */
/* ------------------------------------------------------------------ */

function AddExistingUser() {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const { data: members } = useWorkspaceMembers();
  const { data: users, isLoading: usersLoading } = useAllUsers(search);
  const { data: wsRoles } = useRoles('WORKSPACE');
  const addMember = useAddMember();

  const roleOptions = (wsRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  // Mặc định chọn vai trò "Workspace Member" khi có danh sách vai trò.
  const defaultRoleIds = useMemo(() => {
    const member = (wsRoles ?? []).find((r) => r.name === SYSTEM_ROLES.WORKSPACE_MEMBER);
    return member ? [member.id] : [];
  }, [wsRoles]);
  const effectiveRoleIds = roleIds.length > 0 ? roleIds : defaultRoleIds;

  // Loại người đã ở trong không gian làm việc khỏi pool.
  const memberUserIds = useMemo(() => new Set((members ?? []).map((m) => m.user.id)), [members]);
  const addableUsers = (users ?? []).filter((u) => !memberUserIds.has(u.id));
  const userSelectOptions = addableUsers.map((u) => ({
    value: u.id,
    label: u.displayName,
    hint: u.email,
  }));
  const picked = addableUsers.find((u) => u.id === userId);

  function reset() {
    setUserId('');
    setRoleIds([]);
    setSearch('');
  }

  function submit() {
    if (!userId) {
      toast.error('Chọn một người dùng.');
      return;
    }
    if (effectiveRoleIds.length === 0) {
      toast.error('Chọn ít nhất một vai trò.');
      return;
    }
    addMember.mutate(
      { userId, roleIds: effectiveRoleIds },
      {
        onSuccess: (m) => {
          toast.success(`Đã thêm ${m.user.displayName} vào không gian làm việc`);
          reset();
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Người dùng</span>
          <SearchSelect
            value={userId}
            onChange={setUserId}
            options={userSelectOptions}
            placeholder="Chọn người dùng…"
            searchPlaceholder="Tìm theo tên hoặc email…"
            ariaLabel="Chọn người để thêm vào không gian làm việc"
          />
          {!usersLoading && addableUsers.length === 0 && (
            <p className="text-xs text-faint">
              Mọi người trong hệ thống đều đã là thành viên ở đây.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Vai trò</span>
          <RoleMultiSelect
            options={roleOptions}
            value={effectiveRoleIds}
            onChange={setRoleIds}
            requireOne={false}
            disabled={addMember.isPending}
            placeholder="Mặc định — Thành viên"
            ariaLabel="Vai trò cho thành viên mới"
          />
        </div>
      </div>

      {picked && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <Avatar name={picked.displayName} src={picked.avatarUrl} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{picked.displayName}</p>
            <p className="truncate text-xs text-faint">{picked.email}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setUserId('')}
            aria-label="Bỏ chọn người dùng"
            title="Bỏ chọn"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        onClick={submit}
        loading={addMember.isPending}
        disabled={!userId || effectiveRoleIds.length === 0}
      >
        <UserPlus className="h-4 w-4" />
        Thêm vào không gian làm việc
      </Button>
    </div>
  );
}
