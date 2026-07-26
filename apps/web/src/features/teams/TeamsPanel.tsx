import { useState } from 'react';
import { Crown, FolderPlus, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { useTeams, useDeleteTeam } from './api';
import { TeamEditorModal } from './TeamEditorModal';
import { AssignTeamModal } from './AssignTeamModal';

/** Chồng ảnh đại diện thành viên (tối đa `max`, còn lại hiện +N). */
function MemberStack({ team }: { team: TeamDto }) {
  const max = 5;
  const shown = team.members.slice(0, max);
  const extra = team.memberCount - shown.length;
  if (team.memberCount === 0) return <span className="text-xs text-faint" title="Nhóm này chưa có ai — bấm biểu tượng bút chì để thêm thành viên">Chưa có thành viên</span>;
  return (
    <div className="flex items-center" title={`Nhóm có ${team.memberCount} thành viên`}>
      <div className="flex -space-x-2">
        {shown.map((u) => (
          <span key={u.id} className="rounded-full ring-2 ring-surface" title={`Thành viên nhóm: ${u.displayName}`}>
            <Avatar name={u.displayName} src={u.avatarUrl} size={26} />
          </span>
        ))}
      </div>
      {extra > 0 && <span className="ml-2 text-xs text-muted" title={`Còn ${extra} người nữa`}>+{extra}</span>}
    </div>
  );
}

/** Khu quản lý nhóm trong không gian làm việc — dùng ở tab "Nhóm" của trang Thành viên. */
export function TeamsPanel() {
  const canManage = useAuth((s) => s.can('team:manage'));
  const { data: teams, isLoading } = useTeams();
  const remove = useDeleteTeam();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TeamDto | null>(null);
  const [assignTeam, setAssignTeam] = useState<TeamDto | null>(null);

  function openCreate() { setEditing(null); setEditorOpen(true); }
  function openEdit(t: TeamDto) { setEditing(t); setEditorOpen(true); }
  function handleDelete(t: TeamDto) {
    if (!window.confirm(`Xoá nhóm “${t.name}”?\n\nChỉ nhóm bị xoá — các thành viên vẫn ở lại không gian làm việc và giữ nguyên vai trò.`)) return;
    remove.mutate(t.id, { onError: (e) => toast.error(apiErrorMessage(e)), onSuccess: () => toast.success(`Đã xoá nhóm “${t.name}”`) });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Nhóm</h2>
          <p className="mt-0.5 text-sm text-muted">Gom người theo chức năng (Frontend, QA…) để tìm nhanh và giao vai trò dự án cho cả nhóm cùng lúc.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tạo nhóm</Button>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : !teams || teams.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Chưa có nhóm nào"
            description={canManage
              ? 'Nhóm giúp gom người theo chức năng để giao vai trò cho cả nhóm cùng lúc. Tạo nhóm đầu tiên, ví dụ Frontend hoặc QA.'
              : 'Nhóm giúp gom người theo chức năng. Quản trị chung chưa tạo nhóm nào.'}
            action={canManage ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tạo nhóm</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {teams.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: t.color ?? 'var(--faint)' }} title="Màu nhãn của nhóm — dùng để nhận ra nhóm trong các danh sách" aria-hidden />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink-strong">{t.name}</p>
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted" title="Mã ngắn của nhóm — dùng để gọi tên nhóm cho nhanh">@{t.key}</span>
                    </div>
                    {t.description && <p className="truncate text-xs text-muted" title={t.description}>{t.description}</p>}
                    {t.lead && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-faint" title={`Trưởng nhóm: ${t.lead.displayName}`}>
                        <Crown className="h-3 w-3 text-warning" aria-hidden /> {t.lead.displayName}
                      </p>
                    )}
                  </div>
                </div>

                <MemberStack team={t} />

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" title="Giao cùng một vai trò dự án cho tất cả thành viên của nhóm" aria-label={`Đặt vai trò dự án cho nhóm ${t.name}`} onClick={() => setAssignTeam(t)}>
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Đổi tên, màu, mô tả và thành viên của nhóm" aria-label={`Sửa nhóm ${t.name}`} onClick={() => openEdit(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted hover:text-danger" title="Xoá nhóm — thành viên vẫn ở lại không gian làm việc" aria-label={`Xoá nhóm ${t.name}`} onClick={() => handleDelete(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <TeamEditorModal open={editorOpen} team={editing} onClose={() => setEditorOpen(false)} />
      <AssignTeamModal open={!!assignTeam} team={assignTeam} onClose={() => setAssignTeam(null)} />
    </section>
  );
}
