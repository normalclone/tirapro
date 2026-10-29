import { useDeferredValue, useState } from 'react';
import { Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto, RoleDto, UserStatus } from '@tirapro/types';
import { AddMemberPanel } from './AddMemberPanel';
import { TeamsPanel } from '@/features/teams/TeamsPanel';
import { AddPeopleDialog } from './AddPeopleDialog';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/SectionCard';
import { Input } from '@/components/ui/Input';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { fmtRelative } from '@/lib/dateFormat';
import { normalizeVi } from '@/lib/text';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { MemberRolesCell } from './MemberRolesCell';
import { memberCountParts } from './memberCount';
import { useRemoveMember, useWorkspaceMembers } from './api';
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
  const currentUserId = useAuth((s) => s.user?.id);
  // Chọn ra BOOLEAN (không chọn hàm `can`): trang theo dõi đúng quyền khi `refreshMe` đổi quyền sau tự đổi vai trò.
  const canManage = useAuth((s) => s.can('member:manage'));
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
    <PageFrame size="sm">
      <PageHeader
        title={APP_NAV_LABELS.members}
        description="Ai có tên ở đây đều tham gia mọi dự án; nhóm giúp sắp xếp và giao vai trò hàng loạt."
      />

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
                  {members && members.length > 0 && <MemberCountText members={members} />}
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
                      roles={wsRoles ?? []}
                    />
                  )}
                </QueryBoundary>
              </div>
            </SectionCard>
          </div>
        )}
      </TabPanel>

      <AddPeopleDialog mode="workspace" open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </PageFrame>
  );
}

/** Đầu danh sách: "N đang hoạt động" (+ " · M đã vô hiệu hoá") — nói rõ quy tắc đếm ngay trên mặt chữ. */
function MemberCountText({ members }: { members: Parameters<typeof memberCountParts>[0] }) {
  const parts = memberCountParts(members);
  return (
    <span className="text-sm text-muted">
      <span className="tabular-nums">{parts.active}</span>
      {parts.deactivated && <span className="tabular-nums"> · {parts.deactivated}</span>}
    </span>
  );
}

/** Danh sách thành viên đã lọc theo ô tìm (tên/email, không phân biệt dấu). */
function MemberList({
  members,
  search,
  canManage,
  currentUserId,
  roles,
}: {
  members: MemberDto[];
  search: string;
  canManage: boolean;
  currentUserId: string | undefined;
  roles: RoleDto[];
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
          members={members}
          roles={roles}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  canManage,
  isSelf,
  members,
  roles,
}: {
  member: MemberDto;
  canManage: boolean;
  isSelf: boolean;
  members: MemberDto[];
  roles: RoleDto[];
}) {
  const user = member.user;
  const status = STATUS_META[user.status] ?? STATUS_META.DEACTIVATED;
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
      {/* < sm: dòng 1 = avatar + tên/email; dòng 2 = vai trò + trạng thái + nút gỡ. ≥ sm: một hàng (`sm:contents`). */}
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

      {/* ≥ sm: ba cột bề rộng cố định (vai trò · trạng thái · hành động) để badge thẳng hàng giữa các dòng. */}
      <div className="min-w-0 sm:w-56 sm:shrink-0">
        <MemberRolesCell
          member={member}
          members={members}
          roles={roles}
          canManage={canManage}
          isSelf={isSelf}
        />
      </div>

      <div className="flex sm:w-36 sm:shrink-0 sm:justify-end">
        <Badge className={status.className}>{status.label}</Badge>
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center justify-end max-sm:ml-auto">
          {isSelf ? (
            // Giữ chỗ cùng kích thước nút gỡ: dòng của mình không làm các cột trước đó xê dịch.
            <span
              className="invisible h-9 w-9 max-sm:hidden [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              aria-hidden
              data-testid="member-action-placeholder"
            />
          ) : (
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
