import { useState } from 'react';
import { Crown, FolderPlus, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/stores/auth';
import { useTeams, useDeleteTeam } from './api';
import { TeamEditorModal } from './TeamEditorModal';
import { AssignTeamModal } from './AssignTeamModal';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SectionCard } from '@/components/ui/SectionCard';

/**
 * Lời xác nhận xoá nhóm. Nhóm đang gắn vào dự án (tab "Team" của dự án) thì xoá sẽ gỡ vai trò mà thành viên có nhờ nhóm ở các dự án đó —
 * nói rõ số dự án; nhóm chưa gắn dự án nào chỉ là gom người nên không ảnh hưởng vai trò.
 */
export function deleteDescription(t: Pick<TeamDto, 'projectCount'>): string {
  return t.projectCount > 0
    ? `Nhóm đang gắn vào ${t.projectCount} dự án. Xoá nhóm sẽ gỡ vai trò mà các thành viên có nhờ nhóm này ở những dự án đó (vai trò gán trực tiếp hoặc nhờ nhóm khác được giữ). Họ vẫn ở lại tổ chức.`
    : 'Chỉ nhóm bị xoá — các thành viên vẫn ở lại tổ chức và giữ nguyên vai trò.';
}

/** Chồng ảnh đại diện thành viên (tối đa `max`, còn lại hiện +N). */
function MemberStack({ team }: { team: TeamDto }) {
  const max = 5;
  const shown = team.members.slice(0, max);
  const extra = team.memberCount - shown.length;
  if (team.memberCount === 0)
    return (
      <span
        className="text-xs text-faint"
        title="Nhóm này chưa có ai — bấm biểu tượng bút chì để thêm thành viên"
      >
        Chưa có thành viên
      </span>
    );
  return (
    <div className="flex items-center" title={`Nhóm có ${team.memberCount} thành viên`}>
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <span
            key={u.id}
            className="rounded-full ring-2 ring-surface"
            title={`Thành viên nhóm: ${u.displayName}`}
          >
            <Avatar name={u.displayName} src={u.avatarUrl} size={26} />
          </span>
        ))}
      </div>
      {extra > 0 && (
        <span className="ml-2 text-xs text-muted" title={`Còn ${extra} người nữa`}>
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Khu quản lý nhóm trong tổ chức — dùng ở tab "Nhóm" của trang Thành viên. */
export function TeamsPanel() {
  const canManage = useAuth((s) => s.can('team:manage'));
  const teamsQuery = useTeams();
  const confirm = useConfirm();
  const remove = useDeleteTeam();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TeamDto | null>(null);
  const [assignTeam, setAssignTeam] = useState<TeamDto | null>(null);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(t: TeamDto) {
    setEditing(t);
    setEditorOpen(true);
  }
  async function handleDelete(t: TeamDto) {
    if (
      !(await confirm({
        title: `Xoá nhóm “${t.name}”?`,
        description: deleteDescription(t),
        destructive: true,
      }))
    )
      return;
    remove.mutate(t.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
      onSuccess: () => toast.success(`Đã xoá nhóm “${t.name}”`),
    });
  }

  return (
    <SectionCard
      title="Nhóm"
      description="Gom người theo chức năng (Frontend, QA…) để tìm nhanh và giao vai trò dự án cho cả nhóm cùng lúc."
      actions={
        canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Tạo nhóm
          </Button>
        ) : undefined
      }
    >
      <QueryBoundary
        query={teamsQuery}
        skeleton={
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Chưa có nhóm nào"
            description={
              canManage
                ? 'Nhóm giúp gom người theo chức năng để giao vai trò cho cả nhóm cùng lúc. Tạo nhóm đầu tiên, ví dụ Frontend hoặc QA.'
                : 'Nhóm giúp gom người theo chức năng. Quản trị chưa tạo nhóm nào.'
            }
            action={
              canManage ? (
                <Button variant="secondary" size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Tạo nhóm
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
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ background: t.color ?? 'var(--faint)' }}
                    title="Màu nhãn của nhóm — dùng để nhận ra nhóm trong các danh sách"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink-strong">{t.name}</p>
                      <span
                        className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted"
                        title="Mã ngắn của nhóm — dùng để gọi tên nhóm cho nhanh"
                      >
                        @{t.key}
                      </span>
                    </div>
                    {t.projectCount > 0 && (
                      <p
                        className="mt-0.5 text-xs text-muted"
                        title="Thành viên nhóm có vai trò ở các dự án này nhờ nhóm. Thêm hoặc bớt người sẽ đổi vai trò của họ ở đó."
                      >
                        Gắn vào {t.projectCount} dự án
                      </p>
                    )}
                    {t.description && (
                      <p className="truncate text-xs text-muted" title={t.description}>
                        {t.description}
                      </p>
                    )}
                    {t.lead && (
                      <p
                        className="mt-0.5 flex items-center gap-1 text-xs text-faint"
                        title={`Trưởng nhóm: ${t.lead.displayName}`}
                      >
                        <Crown className="h-3 w-3 text-warning" aria-hidden /> {t.lead.displayName}
                      </p>
                    )}
                  </div>
                </div>

                {/* ≥ sm: bề rộng cố định (5 avatar + "+N") căn phải → cột avatar thẳng hàng giữa các nhóm. */}
                <div className="flex sm:w-40 sm:shrink-0 sm:justify-end">
                  <MemberStack team={t} />
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Giao cùng một vai trò dự án cho tất cả thành viên của nhóm"
                      aria-label={`Đặt vai trò dự án cho nhóm ${t.name}`}
                      onClick={() => setAssignTeam(t)}
                    >
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Đổi tên, màu, mô tả và thành viên của nhóm"
                      aria-label={`Sửa nhóm ${t.name}`}
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-danger"
                      title="Xoá nhóm — thành viên vẫn ở lại tổ chức"
                      aria-label={`Xoá nhóm ${t.name}`}
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

      <TeamEditorModal open={editorOpen} team={editing} onClose={() => setEditorOpen(false)} />
      <AssignTeamModal open={!!assignTeam} team={assignTeam} onClose={() => setAssignTeam(null)} />
    </SectionCard>
  );
}
