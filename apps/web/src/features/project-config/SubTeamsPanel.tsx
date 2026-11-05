import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { MemberDto, ProjectSubTeamDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { AddDialog } from '@/components/ui/AddDialog';
import { Input } from '@/components/ui/Input';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { LABEL_PALETTE } from '@/lib/labelPalette';
import {
  useCreateSubTeam,
  useDeleteSubTeam,
  useProjectSubTeams,
  useUpdateSubTeam,
} from '@/features/project-teams/api';

const DEFAULT_COLOR = LABEL_PALETTE[0]!.hex;

/** Lựa chọn thành viên cho team riêng: mọi thành viên dự án đang hoạt động + người vốn đã ở trong team (kể cả đã bị khoá, kèm nhãn). */
export function subTeamPickerOptions(
  members: readonly MemberDto[],
  team: Pick<ProjectSubTeamDto, 'members'> | null,
): { id: string; name: string }[] {
  const inTeam = new Set(team?.members.map((m) => m.id) ?? []);
  return members
    .filter((m) => m.user.status !== 'DEACTIVATED' || inTeam.has(m.user.id))
    .map((m) => ({
      id: m.user.id,
      name:
        m.user.status === 'DEACTIVATED' ? `${m.user.displayName} (đã khoá)` : m.user.displayName,
    }));
}

/** Chồng ảnh đại diện (tối đa 5, còn lại +N). */
function MemberStack({ team }: { team: ProjectSubTeamDto }) {
  if (team.memberCount === 0) return <span className="text-xs text-faint">Chưa có ai</span>;
  const shown = team.members.slice(0, 5);
  const extra = team.memberCount - shown.length;
  return (
    <div className="flex items-center" title={`${team.memberCount} người`}>
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <span key={u.id} className="rounded-full ring-2 ring-surface" title={u.displayName}>
            <Avatar name={u.displayName} src={u.avatarUrl} size={26} />
          </span>
        ))}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-muted">+{extra}</span>}
    </div>
  );
}

/**
 * Tab "Team trong dự án": team riêng CHỈ để lọc và nhóm việc trên bảng, báo cáo và JQL (`team = "QA"`) — không cấp quyền.
 * Người trong team phải là thành viên dự án; ai rời dự án thì tự ra khỏi team.
 */
export function SubTeamsPanel({
  projectId,
  canAdmin,
  members,
}: {
  projectId?: string;
  canAdmin: boolean;
  members: readonly MemberDto[];
}) {
  const confirm = useConfirm();
  const query = useProjectSubTeams(projectId);
  const remove = useDeleteSubTeam(projectId ?? '');
  const [editing, setEditing] = useState<ProjectSubTeamDto | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleDelete(t: ProjectSubTeamDto) {
    const ok = await confirm({
      title: `Xoá team “${t.name}”?`,
      description:
        'Chỉ xoá team này — mọi người vẫn ở lại dự án. Bộ lọc, hàng theo team trên bảng và JQL dùng tên team này sẽ không còn khớp.',
      confirmLabel: 'Xoá team',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(t.id, {
      onSuccess: () => toast.success(`Đã xoá team “${t.name}”`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">
          Gom người trong dự án thành team (QA, Backend…) để lọc việc, chia hàng trên bảng và xem
          báo cáo theo team. Team ở đây <strong>không cấp quyền</strong>; một người vào được nhiều
          team.
        </p>
        {canAdmin && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Tạo team
          </Button>
        )}
      </div>
      <QueryBoundary
        query={query}
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
            icon={<Users className="h-6 w-6" />}
            title="Chưa có team nào trong dự án"
            description={
              canAdmin
                ? 'Tạo team đầu tiên (ví dụ QA) rồi chọn người từ thành viên dự án. Sau đó lọc bảng theo team hoặc gõ team = "QA" trong JQL.'
                : 'Quản trị dự án chưa tạo team nào.'
            }
            action={
              canAdmin ? (
                <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Tạo team
                </Button>
              ) : undefined
            }
          />
        }
      >
        {(teams) => (
          <ul className="divide-y divide-border">
            {teams.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: t.color ?? 'var(--faint)' }}
                  aria-hidden
                />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-strong">
                  {t.name}
                </p>
                <div className="flex sm:w-40 sm:shrink-0 sm:justify-end">
                  <MemberStack team={t} />
                </div>
                {canAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Đổi tên, màu và thành viên của team"
                      aria-label={`Sửa team ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá team — mọi người vẫn ở lại dự án"
                      aria-label={`Xoá team ${t.name}`}
                      onClick={() => void handleDelete(t)}
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
      {projectId && (
        <SubTeamEditorDialog
          projectId={projectId}
          open={creating || editing !== null}
          team={editing}
          members={members}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function SubTeamEditorDialog({
  projectId,
  open,
  team,
  members,
  onClose,
}: {
  projectId: string;
  open: boolean;
  team: ProjectSubTeamDto | null;
  members: readonly MemberDto[];
  onClose: () => void;
}) {
  const create = useCreateSubTeam(projectId);
  const update = useUpdateSubTeam(projectId);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const editing = team !== null;

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? '');
    setColor(team?.color ?? DEFAULT_COLOR);
    setMemberIds(team?.members.map((m) => m.id) ?? []);
  }, [open, team]);

  // Chỉ chọn trong THÀNH VIÊN DỰ ÁN (dự án riêng tư: người có tên trong dự án; công khai: mọi thành viên tổ chức).
  // Tài khoản đã khoá không thêm mới được (máy chủ từ chối): ẩn, trừ người vốn đã ở trong team (giữ nguyên, ghi "đã khoá").
  const options = useMemo(() => subTeamPickerOptions(members, team), [members, team]);
  const dirty =
    open &&
    (name.trim() !== (team?.name ?? '') ||
      color !== (team?.color ?? DEFAULT_COLOR) ||
      memberIds.slice().sort().join(',') !==
        (team?.members.map((m) => m.id) ?? []).sort().join(','));
  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const payload = { name: name.trim(), color, memberIds };
    try {
      if (team) await update.mutateAsync({ id: team.id, ...payload });
      else await create.mutateAsync(payload);
      toast.success(editing ? `Đã lưu team “${payload.name}”` : `Đã tạo team “${payload.name}”`);
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
      title={editing ? 'Sửa team trong dự án' : 'Tạo team trong dự án'}
      icon={<span className="h-3 w-3 rounded-full" style={{ background: color }} />}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>
            {editing ? 'Lưu' : 'Tạo team'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Tên team</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: QA, Backend…"
            aria-label="Tên team"
            autoFocus
            maxLength={60}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">Màu</label>
          <ColorPicker value={color} onChange={setColor} ariaLabel="Màu của team" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Thành viên <span className="font-normal text-faint">(chọn trong thành viên dự án)</span>
          </label>
          <RoleMultiSelect
            options={options}
            value={memberIds}
            onChange={setMemberIds}
            requireOne={false}
            placeholder="Chọn thành viên…"
            searchPlaceholder="Tìm thành viên…"
            ariaLabel="Thành viên của team"
          />
        </div>
      </div>
    </AddDialog>
  );
}
