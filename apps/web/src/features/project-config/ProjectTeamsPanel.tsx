import { useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, Plus, Unlink, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto, ProjectTeamLinkDto, RoleRefDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { AddDialog } from '@/components/ui/AddDialog';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { RoleMultiSelect, type RoleOption } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { unlinkImpact } from '@/features/members/roleSource';
import { useTeams } from '@/features/teams/api';
import {
  useLinkProjectTeam,
  useProjectTeamLinks,
  useUnlinkProjectTeam,
} from '@/features/project-teams/api';

/** Mô tả hệ quả của việc gỡ team (thuần để test): ai rời dự án / ai chỉ mất bớt vai trò. */
export function unlinkConsequence(
  members: readonly Pick<MemberDto, 'roles' | 'isOverride' | 'user'>[],
  teamId: string,
  isPrivate: boolean,
): string {
  const { leaving, reduced } = unlinkImpact(members, teamId);
  const names = (xs: string[]) =>
    xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} và ${xs.length - 3} người khác`;
  const parts: string[] = [];
  if (leaving.length > 0)
    parts.push(
      isPrivate
        ? `${names(leaving)} sẽ không còn ở dự án (họ chỉ có vai trò nhờ team này).`
        : `${names(leaving)} sẽ quay về vai trò mặc định theo tổ chức (họ chỉ có vai trò nhờ team này).`,
    );
  if (reduced.length > 0)
    parts.push(
      `${names(reduced)} chỉ mất phần vai trò nhờ team này — vai trò gán trực tiếp hoặc nhờ team khác được giữ.`,
    );
  if (parts.length === 0) parts.push('Không ai bị ảnh hưởng ngay lúc này.');
  return parts.join(' ');
}

/** Tab "Team": team của tổ chức gắn vào dự án kèm vai trò; thành viên team tự thành thành viên dự án và đồng bộ khi team đổi người. */
export function ProjectTeamsPanel({
  projectId,
  isPrivate,
  canAdmin,
  members,
  roleOptions,
}: {
  projectId?: string;
  isPrivate: boolean;
  canAdmin: boolean;
  members: readonly MemberDto[];
  roleOptions: RoleOption[];
}) {
  const confirm = useConfirm();
  const linksQuery = useProjectTeamLinks(projectId);
  const teamsQuery = useTeams();
  const unlink = useUnlinkProjectTeam(projectId ?? '');
  const [editing, setEditing] = useState<ProjectTeamLinkDto | null>(null);
  const [linking, setLinking] = useState(false);

  const linked = new Set((linksQuery.data ?? []).map((l) => l.teamId));
  const available = (teamsQuery.data ?? []).filter((t) => !linked.has(t.id));

  async function handleUnlink(l: ProjectTeamLinkDto) {
    const ok = await confirm({
      title: `Gỡ Team ${l.team.name} khỏi dự án?`,
      description: `${unlinkConsequence(members, l.teamId, isPrivate)} Team vẫn còn nguyên ở tổ chức.`,
      confirmLabel: 'Gỡ team',
      destructive: true,
    });
    if (!ok) return;
    unlink.mutate(l.teamId, {
      onSuccess: () => toast.success(`Đã gỡ Team ${l.team.name} khỏi dự án`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">
          Gắn team của tổ chức vào dự án: mọi người trong team thành thành viên dự án với các vai
          trò đã chọn, và tự cập nhật khi team thêm hoặc bớt người.
        </p>
        {canAdmin && (
          <Button
            size="sm"
            onClick={() => setLinking(true)}
            disabled={available.length === 0 && !linksQuery.isLoading}
            title={
              available.length === 0
                ? 'Mọi team của tổ chức đã được gắn vào dự án (hoặc tổ chức chưa có team nào)'
                : undefined
            }
          >
            <Plus className="h-4 w-4" />
            Gắn team
          </Button>
        )}
      </div>
      <QueryBoundary
        query={linksQuery}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <EmptyState
            icon={<Link2 className="h-6 w-6" />}
            title="Chưa gắn team nào vào dự án"
            description={
              canAdmin
                ? 'Gắn một team (ví dụ QA) kèm vai trò để cả team vào dự án một lần, thay vì thêm từng người.'
                : 'Quản trị dự án chưa gắn team nào. Người có quyền quản trị dự án gắn được team ở đây.'
            }
            action={
              canAdmin && available.length > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setLinking(true)}>
                  <Plus className="h-4 w-4" /> Gắn team
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(links) => (
          <ul className="divide-y divide-border">
            {links.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                canAdmin={canAdmin}
                onEdit={() => setEditing(l)}
                onUnlink={() => void handleUnlink(l)}
              />
            ))}
          </ul>
        )}
      </QueryBoundary>
      {projectId && (
        <LinkTeamDialog
          projectId={projectId}
          isPrivate={isPrivate}
          open={linking || editing !== null}
          link={editing}
          teamOptions={available.map((t) => ({
            value: t.id,
            label: t.name,
            hint: `${t.memberCount} người`,
          }))}
          roleOptions={roleOptions}
          onClose={() => {
            setLinking(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function LinkRow({
  link: l,
  canAdmin,
  onEdit,
  onUnlink,
}: {
  link: ProjectTeamLinkDto;
  canAdmin: boolean;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ background: l.team.color ?? 'var(--faint)' }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-strong">Team {l.team.name}</p>
        <p className="text-xs text-faint">
          <Users className="mr-1 inline h-3 w-3" aria-hidden />
          {l.team.memberCount} người
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:w-64 sm:shrink-0 sm:justify-end">
        {l.roles.map((r) => (
          <RoleBadge key={r.id} name={r.name} color={r.color} />
        ))}
      </div>
      {canAdmin && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Đổi vai trò của team trong dự án"
            aria-label={`Đổi vai trò của Team ${l.team.name}`}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted hover:text-danger"
            title="Gỡ team khỏi dự án"
            aria-label={`Gỡ Team ${l.team.name} khỏi dự án`}
            onClick={onUnlink}
          >
            <Unlink className="h-4 w-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Gắn team mới (chọn team + vai trò) hoặc đổi vai trò của team đã gắn (`link` có giá trị). */
function LinkTeamDialog({
  projectId,
  isPrivate,
  open,
  link,
  teamOptions,
  roleOptions,
  onClose,
}: {
  projectId: string;
  isPrivate: boolean;
  open: boolean;
  link: ProjectTeamLinkDto | null;
  teamOptions: { value: string; label: string; hint?: string }[];
  roleOptions: RoleOption[];
  onClose: () => void;
}) {
  const save = useLinkProjectTeam(projectId);
  const [teamId, setTeamId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTeamId(link?.teamId ?? '');
    setRoleIds(link ? link.roles.map((r: RoleRefDto) => r.id) : []);
  }, [open, link]);

  const roles = useMemo(() => roleOptions, [roleOptions]);
  const editing = link !== null;
  const dirty =
    open &&
    ((!editing && teamId !== '') ||
      roleIds.slice().sort().join(',') !== (link?.roles.map((r) => r.id) ?? []).sort().join(','));
  const canSave = (editing || !!teamId) && roleIds.length > 0 && !save.isPending;

  async function submit() {
    if (!canSave) return;
    try {
      await save.mutateAsync({ teamId: link?.teamId ?? teamId, roleIds });
      toast.success(editing ? 'Đã đổi vai trò của team' : 'Đã gắn team vào dự án');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <AddDialog
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={editing ? `Vai trò của Team ${link.team.name}` : 'Gắn team vào dự án'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void submit()} loading={save.isPending} disabled={!canSave}>
            {editing ? 'Lưu' : 'Gắn team'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Team</label>
            <SearchSelect
              value={teamId}
              onChange={setTeamId}
              options={teamOptions}
              placeholder="Chọn team của tổ chức…"
              searchPlaceholder="Tìm team…"
              ariaLabel="Team của tổ chức"
            />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Vai trò trong dự án</label>
          <RoleMultiSelect
            options={roles}
            value={roleIds}
            onChange={setRoleIds}
            placeholder="Chọn vai trò…"
            ariaLabel="Vai trò của team trong dự án"
          />
        </div>
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
          Mọi thành viên của team nhận các vai trò này trong dự án. Thêm hoặc bớt người trong team
          sẽ tự cập nhật dự án. Gỡ team chỉ bỏ phần vai trò nhờ team — vai trò gán trực tiếp được
          giữ.
          {!isPrivate &&
            ' Dự án công khai: ai đã có vai trò mặc định theo tổ chức vẫn giữ quyền đó, cộng thêm vai trò của team.'}
        </p>
      </div>
    </AddDialog>
  );
}
