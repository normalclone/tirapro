import { useDeferredValue, useState } from 'react';
import { Pencil, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto, UserStatus } from '@tirapro/types';
import { AddMemberPanel } from './AddMemberPanel';
import { TeamsPanel } from '@/features/teams/TeamsPanel';
import { AddPeopleDialog } from './AddPeopleDialog';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/useConfirm';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { apiErrorMessage } from '@/lib/api';
import { fmtRelative } from '@/lib/dateFormat';
import { normalizeVi } from '@/lib/text';
import { pageContainer } from '@/components/layout/page';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { EditRolesPopover } from './EditRolesPopover';
import { useRemoveMember, useSetMemberRoles, useWorkspaceMembers } from './api';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { APP_NAV_LABELS } from '@/lib/navLabels';

/** Nhãn + màu badge tiếng Việt cho từng trạng thái tài khoản. */
const STATUS_META: Record<UserStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Đang hoạt động', className: 'bg-success/10 text-success' },
  INVITED: { label: 'Chưa kích hoạt', className: 'bg-primary-subtle text-primary' },
  DEACTIVATED: { label: 'Đã vô hiệu hoá', className: 'bg-surface-2 text-muted' },
};

type Tab = 'members' | 'teams';

export function MembersPage() {
  const can = useAuth((s) => s.can);
  const currentUserId = useAuth((s) => s.user?.id);
  const canManage = can('member:manage');
  const [tab, setTab] = useState<Tab>('members');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const memberQuery = useDeferredValue(memberSearch);

  const membersQuery = useWorkspaceMembers();
  const { data: members } = membersQuery;
  const { data: wsRoles } = useRoles('WORKSPACE');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'members', label: 'Thành viên' },
    { id: 'teams', label: 'Nhóm' },
  ];

  return (
    <div className={pageContainer('sm')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
          {APP_NAV_LABELS.members}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Thành viên thuộc về cả không gian làm việc, nên ai có tên ở đây đều tham gia mọi dự án.
          Nhóm dùng để sắp xếp họ theo chức năng và giao vai trò hàng loạt.
        </p>
      </header>

      <Tabs
        idBase="members"
        ariaLabel="Thành viên & nhóm"
        value={tab}
        onChange={setTab}
        items={tabs}
        className="mb-6"
        data-tour="members-tabs"
      />

      <TabPanel idBase="members" value={tab}>
        {tab === 'teams' ? (
          <TeamsPanel />
        ) : (
          <div className="space-y-8">
            <AddMemberPanel />

            <SectionCard
              title="Danh sách thành viên"
              bare
              data-tour="members-list"
              actions={
                <>
                  {members && members.length > 0 && (
                    <span
                      className="text-sm text-muted"
                      title={`Không gian làm việc hiện có ${members.length} người`}
                    >
                      {members.length} người
                    </span>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Chọn nhiều người có sẵn trong hệ thống và thêm cùng lúc"
                      onClick={() => setBulkOpen(true)}
                    >
                      <UserPlus className="h-4 w-4" /> Thêm nhiều người
                    </Button>
                  )}
                </>
              }
            >
              {members && members.length > 0 && (
                <div className="border-b border-border px-5 py-3">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                      aria-hidden
                    />
                    <Input
                      type="search"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Tìm thành viên…"
                      aria-label="Tìm thành viên"
                      className="pl-8"
                    />
                  </div>
                </div>
              )}

              <div className="p-5">
                <QueryBoundary
                  query={membersQuery}
                  skeleton={
                    <div className="space-y-2.5">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  }
                  empty={(d) => d.length === 0}
                  emptyState={
                    <EmptyState
                      icon={<Users className="h-6 w-6" />}
                      title="Chưa có thành viên nào"
                      description="Đây là danh sách người được vào không gian làm việc này. Chọn người dùng có sẵn ở ô phía trên để thêm người đầu tiên."
                    />
                  }
                >
                  {(members) => (
                    <MemberList
                      members={members}
                      search={memberQuery}
                      canManage={canManage}
                      currentUserId={currentUserId}
                      roleOptions={wsRoles ?? []}
                    />
                  )}
                </QueryBoundary>
              </div>
            </SectionCard>
          </div>
        )}
      </TabPanel>

      <AddPeopleDialog mode="workspace" open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  );
}

/** Danh sách thành viên đã lọc theo ô tìm (tên/email, không phân biệt dấu). */
function MemberList({
  members,
  search,
  canManage,
  currentUserId,
  roleOptions,
}: {
  members: MemberDto[];
  search: string;
  canManage: boolean;
  currentUserId: string | undefined;
  roleOptions: { id: string; name: string; color?: string | null }[];
}) {
  const q = normalizeVi(search);
  const shown = q
    ? members.filter(
        (m) => normalizeVi(m.user.displayName).includes(q) || normalizeVi(m.user.email).includes(q),
      )
    : members;
  if (shown.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">
        Không có thành viên nào khớp “{search.trim()}”.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {shown.map((m) => (
        <MemberRow
          key={m.membershipId}
          member={m}
          canManage={canManage}
          isSelf={m.user.id === currentUserId}
          roleOptions={roleOptions}
        />
      ))}
    </ul>
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
  const confirm = useConfirm();

  async function handleRemove() {
    const ok = await confirm({
      title: `Gỡ ${user.displayName} khỏi không gian làm việc?`,
      description:
        'Họ sẽ mất quyền vào mọi dự án ở đây. Việc đã giao cho họ vẫn giữ nguyên. Bạn có thể thêm lại sau.',
      confirmLabel: 'Gỡ',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(user.id, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      {/* < sm: dòng 1 = avatar + tên/email; dòng 2 = vai trò + trạng thái + nút sửa. ≥ sm: một hàng (`sm:contents`). */}
      <div className="flex min-w-0 basis-full items-center gap-3 sm:contents">
        <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {user.displayName}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-faint">(bạn)</span>}
          </p>
          <p className="truncate text-xs text-faint">{user.email}</p>
          {/* Hoạt động của người khác chỉ hiện cho người quản lý thành viên (không phô cho vai Người xem). */}
          {canManage && (
            <p className="truncate text-xs text-faint">
              {user.lastSeenAt
                ? `Hoạt động ${fmtRelative(user.lastSeenAt)}`
                : 'Chưa từng đăng nhập'}
            </p>
          )}
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5 sm:justify-end"
        title="Vai trò quyết định người này được xem và làm gì ở đây"
      >
        {member.roles.length > 0 ? (
          member.roles.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
        ) : (
          <span className="text-xs text-faint">Chưa có vai trò</span>
        )}
      </div>

      <Badge className={status.className}>{status.label}</Badge>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1 max-sm:ml-auto">
          <EditRolesPopover
            roles={roleOptions}
            current={member.roles}
            saving={setRoles.isPending}
            onSave={(roleIds) => setRoles.mutateAsync({ userId: user.id, roleIds })}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                title={`Đổi vai trò chung của ${user.displayName}`}
                aria-label={`Sửa vai trò của ${user.displayName}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          {!isSelf && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title={`Gỡ ${user.displayName} khỏi không gian làm việc — họ sẽ mất quyền vào mọi dự án`}
              aria-label={`Gỡ ${user.displayName} khỏi không gian làm việc`}
              loading={remove.isPending}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
