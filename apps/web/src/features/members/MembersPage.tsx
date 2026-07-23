import { useState } from 'react';
import { Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto, UserStatus } from '@tirapro/types';
import { InvitePanel } from '@/features/workspace/InvitePanel';
import { TeamsPanel } from '@/features/teams/TeamsPanel';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { apiErrorMessage } from '@/lib/api';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { EditRolesPopover } from './EditRolesPopover';
import { useRemoveMember, useSetMemberRoles, useWorkspaceMembers } from './api';

/** Nhãn + màu badge tiếng Việt cho từng trạng thái tài khoản. */
const STATUS_META: Record<UserStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Đang hoạt động', className: 'bg-success/10 text-success' },
  INVITED: { label: 'Đã mời', className: 'bg-primary-subtle text-primary' },
  DEACTIVATED: { label: 'Đã vô hiệu hoá', className: 'bg-surface-2 text-muted' },
};

type Tab = 'members' | 'teams';

export function MembersPage() {
  const can = useAuth((s) => s.can);
  const currentUserId = useAuth((s) => s.user?.id);
  const canManage = can('member:manage');
  const [tab, setTab] = useState<Tab>('members');

  const { data: members, isLoading } = useWorkspaceMembers();
  const { data: wsRoles } = useRoles('WORKSPACE');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'members', label: 'Thành viên' },
    { id: 'teams', label: 'Nhóm' },
  ];

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Thành viên & nhóm</h1>
        <p className="mt-1 text-sm text-muted">
          Những người có quyền truy cập workspace này, và các nhóm để tổ chức họ.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Thành viên & nhóm">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'teams' ? (
        <TeamsPanel />
      ) : (
      <div className="space-y-8">
        <InvitePanel />

        <section className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-ink-strong">Danh sách thành viên</h2>
            {members && members.length > 0 && (
              <span className="text-sm text-muted">{members.length} người</span>
            )}
          </div>

          <div className="p-5">
            {isLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !members || members.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title="Chưa có thành viên"
                description="Mời người đầu tiên vào workspace bằng biểu mẫu phía trên."
              />
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <MemberRow
                    key={m.membershipId}
                    member={m}
                    canManage={canManage}
                    isSelf={m.user.id === currentUserId}
                    roleOptions={wsRoles ?? []}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      )}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  isSelf,
  roleOptions,
}: {
  member: MemberDto;
  canManage: boolean;
  isSelf: boolean;
  roleOptions: { id: string; name: string; color?: string | null }[];
}) {
  const user = member.user;
  const status = STATUS_META[user.status] ?? STATUS_META.DEACTIVATED;
  const setRoles = useSetMemberRoles();
  const remove = useRemoveMember();

  function handleRemove() {
    if (!window.confirm(`Gỡ ${user.displayName} khỏi workspace?`)) return;
    remove.mutate(user.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {user.displayName}
          {isSelf && <span className="ml-1.5 text-xs font-normal text-faint">(bạn)</span>}
        </p>
        <p className="truncate text-xs text-faint">{user.email}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {member.roles.length > 0 ? (
          member.roles.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
        ) : (
          <span className="text-xs text-faint">Chưa có vai trò</span>
        )}
      </div>

      <Badge className={status.className}>{status.label}</Badge>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <EditRolesPopover
            roles={roleOptions}
            current={member.roles}
            saving={setRoles.isPending}
            onSave={(roleIds) => setRoles.mutateAsync({ userId: user.id, roleIds })}
            trigger={
              <Button variant="ghost" size="icon" title="Sửa vai trò" aria-label={`Sửa vai trò của ${user.displayName}`}>
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          {!isSelf && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Gỡ khỏi workspace"
              aria-label={`Gỡ ${user.displayName} khỏi workspace`}
              loading={remove.isPending}
              onClick={handleRemove}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
