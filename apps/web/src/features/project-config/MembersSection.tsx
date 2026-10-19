import { useState } from 'react';
import { Pencil, History, UserMinus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto } from '@tirapro/types';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCan } from '@/features/projects/permissions';
import { useRoles } from '@/features/roles/api';
import { EditRolesPopover } from '@/features/members/EditRolesPopover';
import { AddPeopleDialog } from '@/features/members/AddPeopleDialog';
import {
  useProjectMembers,
  useRemoveProjectMember,
  useSetProjectMemberRoles,
} from '@/features/members/api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';

/* ------------------------------------------------------------------ */
/* Section — Thành viên dự án                                          */
/* ------------------------------------------------------------------ */

export function MembersSection({
  projectId,
  isPrivate = false,
}: {
  projectId?: string;
  isPrivate?: boolean;
}) {
  const confirm = useConfirm();
  const canAdmin = useCan(projectId)('project:admin');

  // Thành viên dự án = TOÀN BỘ thành viên của không gian làm việc (dự án dùng chung tập người dùng).
  // `isOverride` cho biết vai trò đang là ĐẶT RIÊNG hay MẶC ĐỊNH theo vai trò chung.
  const membersQuery = useProjectMembers(projectId);
  const { data: members } = membersQuery;
  const { data: projectRoles } = useRoles('PROJECT');

  const setRoles = useSetProjectMemberRoles(projectId ?? '');
  const clearOverride = useRemoveProjectMember(projectId ?? '');

  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const list = members ?? [];
  const roleOptions = (projectRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));
  const query = q.trim().toLowerCase();
  const shown = query
    ? list.filter((m) => `${m.user.displayName} ${m.user.email}`.toLowerCase().includes(query))
    : list;

  async function handleReset(name: string, uid: string) {
    const ok = await confirm(
      isPrivate
        ? {
            title: `Gỡ ${name} khỏi dự án?`,
            description: 'Người này sẽ không còn thấy dự án riêng tư này.',
            confirmLabel: 'Gỡ khỏi dự án',
            destructive: true,
          }
        : { title: `Đưa ${name} về vai trò mặc định chung?` },
    );
    if (!ok) return;
    clearOverride.mutate(uid, {
      onSuccess: () => toast.success(isPrivate ? 'Đã gỡ khỏi dự án' : 'Đã về vai trò mặc định'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <SectionCard
      icon={<Users className="h-4 w-4" />}
      title="Thành viên"
      description={
        isPrivate
          ? 'Dự án riêng tư — chỉ những người ở đây (và quản trị) thấy dự án.'
          : 'Mọi thành viên của không gian làm việc đều tham gia dự án này. Có thể đặt vai trò riêng cho từng người khi cần.'
      }
    >
      <QueryBoundary
        query={membersQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        empty={() => list.length === 0}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Chưa có thành viên nào"
            description="Thêm người vào không gian làm việc ở trang Thành viên — họ sẽ tự động tham gia mọi dự án."
          />
        }
      >
        {() => (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm thành viên…"
                className="h-9 max-w-xs text-sm"
              />
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm text-muted">{list.length} người</span>
                {isPrivate && canAdmin && (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <UserPlus className="h-4 w-4" />
                    Thêm người
                  </Button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-border">
              {shown.map((m) => (
                <MemberRow
                  key={m.user.id}
                  m={m}
                  isPrivate={isPrivate}
                  canAdmin={canAdmin}
                  roleOptions={roleOptions}
                  saving={setRoles.isPending}
                  onSaveRoles={(ids) => setRoles.mutateAsync({ userId: m.user.id, roleIds: ids })}
                  onReset={() => handleReset(m.user.displayName, m.user.id)}
                />
              ))}
              {shown.length === 0 && (
                <li className="py-6 text-center text-sm text-muted">
                  Không tìm thấy ai khớp “{q}”.
                </li>
              )}
            </ul>
          </>
        )}
      </QueryBoundary>
      {isPrivate && (
        <AddPeopleDialog
          mode="project"
          projectId={projectId}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </SectionCard>
  );
}

interface MemberRowProps {
  m: MemberDto;
  isPrivate: boolean;
  canAdmin: boolean;
  roleOptions: { id: string; name: string; color?: string | null }[];
  saving: boolean;
  onSaveRoles: (ids: string[]) => Promise<unknown>;
  onReset: () => void;
}

function MemberRow({
  m,
  isPrivate,
  canAdmin,
  roleOptions,
  saving,
  onSaveRoles,
  onReset,
}: MemberRowProps) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{m.user.displayName}</p>
        <p className="truncate text-xs text-faint">{m.user.email}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {m.roles.length > 0 ? (
          m.roles.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
        ) : (
          <span className="text-xs text-faint">Chỉ xem</span>
        )}
        {!isPrivate && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              m.isOverride ? 'bg-primary-subtle text-primary' : 'bg-surface-2 text-faint',
            )}
            title={
              m.isOverride
                ? 'Vai trò đặt riêng cho dự án này'
                : 'Vai trò mặc định suy từ vai trò chung'
            }
          >
            {m.isOverride ? 'riêng' : 'mặc định'}
          </span>
        )}
      </div>
      {canAdmin && (
        <div className="flex shrink-0 items-center gap-1">
          <EditRolesPopover
            roles={roleOptions}
            current={m.roles}
            saving={saving}
            onSave={onSaveRoles}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                title="Đặt vai trò riêng cho dự án"
                aria-label={`Đặt vai trò riêng cho ${m.user.displayName}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            }
          />
          {m.isOverride && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-ink"
              title={isPrivate ? 'Gỡ khỏi dự án' : 'Về vai trò mặc định'}
              aria-label={
                isPrivate
                  ? `Gỡ ${m.user.displayName} khỏi dự án`
                  : `Đưa ${m.user.displayName} về vai trò mặc định`
              }
              onClick={onReset}
            >
              {isPrivate ? <UserMinus className="h-4 w-4" /> : <History className="h-4 w-4" />}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
