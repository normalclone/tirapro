import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, History, UserMinus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto } from '@tirapro/types';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { apiErrorMessage } from '@/lib/api';
import { useCan } from '@/features/projects/permissions';
import { useAuth } from '@/stores/auth';
import { frozenAdminRoles } from '@/features/members/adminGrant';
import { adminRoleIds } from '@/features/members/roleChange';
import { useRoles } from '@/features/roles/api';
import { useAssignableProjectRoles } from '@/features/roles/projectRolesApi';
import { configSectionPath } from './configSections';
import { EditRolesPopover } from '@/features/members/EditRolesPopover';
import { AddPeopleDialog } from '@/features/members/AddPeopleDialog';
import {
  useProjectMembers,
  useRemoveProjectMember,
  useSetProjectMemberRoles,
} from '@/features/members/api';
import {
  isTeamOnlyMember,
  memberHasDirectRoles,
  memberTeamNames,
  roleSourceOf,
} from '@/features/members/roleSource';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';
import { ProjectTeamsPanel } from './ProjectTeamsPanel';
import { SubTeamsPanel } from './SubTeamsPanel';

/** Ba tab của mục Thành viên dự án (đồng bộ với `?tab=` để chia sẻ được đường dẫn). */
const MEMBER_TABS = ['members', 'teams', 'sub-teams'] as const;
export type MemberTab = (typeof MEMBER_TABS)[number];
export const memberTabFromParam = (raw: string | null): MemberTab =>
  (MEMBER_TABS as readonly string[]).includes(raw ?? '') ? (raw as MemberTab) : 'members';

const TAB_ID_BASE = 'project-members';

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
  const canAdmin = useCan(projectId)('project:admin');
  const [params, setParams] = useSearchParams();
  const tab = memberTabFromParam(params.get('tab'));
  // Danh sách thành viên + vai trò dùng chung cho cả ba tab (gỡ team cần biết ai bị ảnh hưởng, team riêng chọn người từ đây).
  const membersQuery = useProjectMembers(projectId);
  // `projectRoles` = MẪU vai trò cấp dự án (chỉ để nhận ra mẫu mang quyền quản trị bị khoá); danh sách CHỌN là vai trò của dự án.
  const { data: projectRoles } = useRoles('PROJECT');
  const assignable = useAssignableProjectRoles(projectId);
  const roleOptions = assignable.options;
  const { key: projectKey = '' } = useParams();
  const rolesHref = configSectionPath(projectKey, 'roles');
  const members = membersQuery.data ?? [];
  // P-C14: người không phải quản trị tổ chức không gắn/gỡ được vai trò mang `organization:admin` (khoá kèm lý do, máy chủ vẫn kiểm).
  const canGrantAdmin = useAuth((s) => s.can('organization:admin'));
  const frozenRoles = frozenAdminRoles(canGrantAdmin, adminRoleIds(projectRoles ?? []));

  const items: TabItem<MemberTab>[] = [
    {
      id: 'members',
      label: 'Thành viên',
      title: 'Danh sách người trong dự án và vai trò của từng người',
    },
    { id: 'teams', label: 'Team', title: 'Team của tổ chức gắn vào dự án kèm vai trò' },
    {
      id: 'sub-teams',
      label: 'Team trong dự án',
      title: 'Team riêng của dự án để lọc và gom việc — không cấp quyền',
    },
  ];
  const setTab = (next: MemberTab) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'members') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  return (
    <SectionCard>
      <Tabs
        idBase={TAB_ID_BASE}
        value={tab}
        onChange={setTab}
        items={items}
        ariaLabel="Thành viên và team của dự án"
        className="mb-4"
      />
      <TabPanel idBase={TAB_ID_BASE} value={tab}>
        {tab === 'members' ? (
          <MembersList
            projectId={projectId}
            isPrivate={isPrivate}
            canAdmin={canAdmin}
            membersQuery={membersQuery}
            roleOptions={roleOptions}
            needsRoles={assignable.needsRoles}
            rolesHref={rolesHref}
          />
        ) : tab === 'teams' ? (
          <ProjectTeamsPanel
            projectId={projectId}
            isPrivate={isPrivate}
            canAdmin={canAdmin}
            members={members}
            roleOptions={roleOptions}
            frozenRoles={frozenRoles}
          />
        ) : (
          <SubTeamsPanel projectId={projectId} canAdmin={canAdmin} members={members} />
        )}
      </TabPanel>
    </SectionCard>
  );
}

function MembersList({
  projectId,
  isPrivate,
  canAdmin,
  membersQuery,
  roleOptions,
  needsRoles,
  rolesHref,
}: {
  projectId?: string;
  isPrivate: boolean;
  canAdmin: boolean;
  membersQuery: ReturnType<typeof useProjectMembers>;
  roleOptions: { id: string; name: string; color?: string | null }[];
  /** Dự án chưa có vai trò nào để chọn → gợi ý tạo từ mẫu. */
  needsRoles: boolean;
  rolesHref: string;
}) {
  const confirm = useConfirm();

  // Thành viên dự án = người được THÊM vào dự án (trực tiếp hoặc qua team). Dự án công khai: ai trong tổ chức cũng xem được
  // nhưng chỉ người ở đây mới làm việc. `isOverride` cho biết vai trò đang là ĐẶT RIÊNG hay MẶC ĐỊNH theo vai trò chung.
  const { data: members } = membersQuery;

  const setRoles = useSetProjectMemberRoles(projectId ?? '');
  const clearOverride = useRemoveProjectMember(projectId ?? '');

  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const list = members ?? [];
  const query = q.trim().toLowerCase();
  const shown = query
    ? list.filter((m) => `${m.user.displayName} ${m.user.email}`.toLowerCase().includes(query))
    : list;

  async function handleReset(m: MemberDto) {
    const name = m.user.displayName;
    const uid = m.user.id;
    const teams = memberTeamNames(m);
    // Còn vai trò nhờ team: gỡ phần "riêng" KHÔNG đưa người ra khỏi dự án — nói rõ để không tưởng đã gỡ hẳn.
    const stays = teams.length > 0 ? ` ${name} vẫn ở dự án nhờ Team ${teams.join(', ')}.` : '';
    const ok = await confirm(
      teams.length > 0
        ? {
            title: `Gỡ vai trò riêng của ${name}?`,
            description: `Chỉ bỏ vai trò gán trực tiếp.${stays}`,
            confirmLabel: 'Gỡ vai trò riêng',
            destructive: true,
          }
        : {
            title: `Gỡ ${name} khỏi dự án?`,
            description: isPrivate
              ? 'Người này sẽ không còn thấy dự án riêng tư này.'
              : 'Người này chỉ còn xem được dự án, không làm việc trong đó nữa.',
            confirmLabel: 'Gỡ khỏi dự án',
            destructive: true,
          },
    );
    if (!ok) return;
    clearOverride.mutate(uid, {
      onSuccess: () => toast.success(teams.length > 0 ? 'Đã gỡ vai trò riêng' : 'Đã gỡ khỏi dự án'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <>
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
            description={
              canAdmin
                ? 'Thêm người vào dự án và chọn vai trò cho họ.'
                : 'Chưa ai được thêm vào dự án này.'
            }
            action={
              canAdmin && !needsRoles ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <UserPlus className="h-4 w-4" />
                  Thêm người
                </Button>
              ) : undefined
            }
          />
        }
      >
        {() => (
          <>
            {canAdmin && needsRoles && <NeedsRolesHint href={rolesHref} />}
            <div className="mb-3 flex items-center justify-between gap-3">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm thành viên…"
                className="h-9 max-w-xs text-sm"
              />
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm text-muted">{list.length} người</span>
                {canAdmin && (
                  <Button size="sm" onClick={() => setAdding(true)} disabled={needsRoles}>
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
                  canAdmin={canAdmin}
                  roleOptions={roleOptions}
                  saving={setRoles.isPending}
                  onSaveRoles={(ids) => setRoles.mutateAsync({ userId: m.user.id, roleIds: ids })}
                  onReset={() => void handleReset(m)}
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
      {canAdmin && (
        <AddPeopleDialog
          mode="project"
          projectId={projectId}
          rolesHref={rolesHref}
          open={adding}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

/** Dự án chưa có vai trò → không có gì để gán: dẫn sang mục Vai trò để tạo từ mẫu. */
function NeedsRolesHint({ href }: { href: string }) {
  return (
    <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-muted">
      Dự án chưa có vai trò nào để gán cho người mới.{' '}
      <Link to={href} className="font-medium text-primary hover:underline">
        Tạo vai trò từ mẫu
      </Link>
    </p>
  );
}

/**
 * Vai trò chọn được cho một người = vai trò của dự án + những vai trò người đó ĐANG giữ (vd mẫu hệ thống gán từ trước): các gán cũ
 * vẫn hiệu lực và hiện đúng trong hộp chọn, lưu lại không làm mất chúng.
 */
export function withCurrentRoles<T extends { id: string; name: string; color?: string | null }>(
  options: T[],
  m: MemberDto,
): { id: string; name: string; color?: string | null }[] {
  const have = new Set(options.map((o) => o.id));
  const extra = m.roles
    .filter((r) => !have.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));
  return [...options, ...extra];
}

interface MemberRowProps {
  m: MemberDto;
  canAdmin: boolean;
  roleOptions: { id: string; name: string; color?: string | null }[];
  saving: boolean;
  onSaveRoles: (ids: string[]) => Promise<unknown>;
  onReset: () => void;
}

function MemberRow({ m, canAdmin, roleOptions, saving, onSaveRoles, onReset }: MemberRowProps) {
  const hasDirect = memberHasDirectRoles(m);
  const teamOnly = isTeamOnlyMember(m);
  const teams = memberTeamNames(m);
  const stillViaTeams = hasDirect && teams.length > 0;
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 sm:items-center">
      <Avatar name={m.user.displayName} src={m.user.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{m.user.displayName}</p>
        <p className="truncate text-xs text-faint">{m.user.email}</p>
      </div>
      {/* ≥ sm: cột vai trò bề rộng cố định → thẳng hàng giữa các dòng; mỗi vai trò kèm nguồn của nó. */}
      <div className="flex flex-col items-end gap-1 sm:w-72 sm:shrink-0">
        {m.roles.length > 0 ? (
          m.roles.map((r) => {
            const src = roleSourceOf(r, m);
            return (
              <span key={r.id} className="flex flex-wrap items-center justify-end gap-1.5">
                <RoleBadge name={r.name} color={r.color} />
                {src && (
                  <span className="text-[11px] text-muted" title={src.title}>
                    {src.label}
                  </span>
                )}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-faint">Chỉ xem</span>
        )}
      </div>
      {canAdmin && (
        <div className="flex shrink-0 items-center gap-1">
          <EditRolesPopover
            roles={withCurrentRoles(roleOptions, m)}
            current={m.roles}
            saving={saving}
            onSave={onSaveRoles}
            notice={
              teamOnly
                ? 'Người này đang có vai trò nhờ team và/hoặc mặc định theo tổ chức. Lưu sẽ đặt các vai trò đã chọn thành vai trò riêng (không còn phụ thuộc team hay mặc định); vai trò nhờ team vẫn giữ nguyên.'
                : stillViaTeams
                  ? `Vai trò nhờ Team ${teams.join(', ')} không đổi khi bạn lưu — chỉ phần vai trò riêng được đặt lại.`
                  : undefined
            }
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
          {hasDirect ? (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-ink"
              title={teams.length > 0 ? 'Gỡ vai trò riêng (vẫn ở dự án nhờ team)' : 'Gỡ khỏi dự án'}
              aria-label={
                teams.length > 0
                  ? `Gỡ vai trò riêng của ${m.user.displayName}`
                  : `Gỡ ${m.user.displayName} khỏi dự án`
              }
              onClick={onReset}
            >
              {teams.length === 0 ? (
                <UserMinus className="h-4 w-4" />
              ) : (
                <History className="h-4 w-4" />
              )}
            </Button>
          ) : (
            // Giữ chỗ cùng cỡ nút "về mặc định": cột vai trò không xê dịch giữa các dòng.
            <span
              className="invisible h-9 w-9 max-sm:hidden [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              aria-hidden
              data-testid="row-action-placeholder"
            />
          )}
        </div>
      )}
    </li>
  );
}
