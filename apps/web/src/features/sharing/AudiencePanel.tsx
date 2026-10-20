import { useId } from 'react';
import { Avatar } from '@/components/ui/primitives';
import { useProjectMembers } from '@/features/members/api';
import { useProjects } from '@/features/projects/api';
import { useTeams } from '@/features/teams/api';
import { useMyWorkspaces } from '@/features/workspace/api';
import { fmtNumber } from '@/lib/locale';
import { useAuth } from '@/stores/auth';
import { activePeople, audienceView, type AudienceInput } from './audience';
import type { ShareValue } from './shareModel';

/**
 * "Ai có quyền xem" theo mức đang chọn. Chỉ dùng dữ liệu người xem vốn đã thấy: nhóm (`useTeams`), thành viên dự án RIÊNG
 * TƯ qua `GET /projects/:id/members` (đòi quyền xem dự án — không đọc được thì chỉ ghi chú, không lộ đội hình), số thành
 * viên không gian (`memberCount`). Avatar chỉ trang trí (ẩn khỏi trình đọc màn hình); MỘT câu sr-only nêu tên thay thế.
 */
export function AudiencePanel({ value }: { value: ShareValue }) {
  const labelId = useId();
  const workspaceId = useAuth((s) => s.workspaceId);
  const { data: workspaces } = useMyWorkspaces();
  const { data: projects } = useProjects(true);
  const { data: teams } = useTeams();

  const project = (projects ?? []).find((p) => p.id === value.projectId);
  const privateProjectId = value.scope === 'PROJECT' && project?.isPrivate ? project.id : undefined;
  const members = useProjectMembers(privateProjectId);
  const team = (teams ?? []).find((t) => t.id === value.teamId);

  const input: AudienceInput = {
    scope: value.scope,
    memberCount: workspaces?.find((w) => w.id === workspaceId)?.memberCount,
    team: value.scope === 'TEAM' && team ? team : null,
    project: value.scope === 'PROJECT' && project ? project : null,
    projectMembers: privateProjectId
      ? {
          status: members.data ? 'ready' : members.isError ? 'error' : 'loading',
          people: activePeople((members.data ?? []).map((m) => m.user)),
        }
      : undefined,
  };
  const v = audienceView(input);

  return (
    <section aria-labelledby={labelId} className="mt-4 rounded-lg border border-border p-3">
      <h3 id={labelId} className="text-xs font-medium text-muted">
        Ai có quyền xem
      </h3>
      <div className="mt-2 flex items-center gap-2.5">
        {v.people.length > 0 && (
          <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
            {v.people.map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-surface">
                <Avatar name={p.name} src={p.avatarUrl} size={24} decorative />
              </span>
            ))}
            {v.extra > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted ring-2 ring-surface">
                +{fmtNumber(v.extra)}
              </span>
            )}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {v.headline}
            {v.names && <span className="sr-only">. {v.names}</span>}
          </p>
          {v.note && <p className="text-xs text-muted">{v.note}</p>}
        </div>
      </div>
    </section>
  );
}
