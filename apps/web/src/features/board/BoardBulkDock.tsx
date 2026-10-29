import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ProjectDto } from '@tirapro/types';
import { BulkDock } from '@/features/bulk/BulkDock';
import { commonNextStatuses } from '@/features/bulk/bulkEdit';
import { useBulkEdit } from '@/features/bulk/useBulkEdit';
import type { PriorityChoice } from '@/features/backlog/InlineEdits';
import { useProjectSprints } from '@/features/backlog/api';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectLabels, type ProjectLabel } from '@/features/issue-meta/api';
import { useCanEditIssue, useProjectCan } from '@/features/projects/permissions';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useAuth } from '@/stores/auth';
import { keys } from '@/lib/queryKeys';

const NO_LABELS: ProjectLabel[] = [];
const NO_PRIORITIES: PriorityChoice[] = [];

/**
 * Dock hàng loạt của Bảng việc. Chỉ mount khi đang có lựa chọn nên các hook dữ liệu (meta, nhãn, workflow) không chạy khi
 * không dùng. Bảng thuộc MỘT dự án → mọi lần gọi bulk dùng một `projectId` (API chỉ nhận một dự án/lần); gửi kèm `boardId`
 * để máy chủ kiểm giới hạn WIP khi đổi trạng thái. Không có nhóm Sprint/Epic ở bảng (không truyền handler = ẩn).
 */
export function BoardBulkDock({
  project,
  boardId,
  issues,
  selected,
  onClear,
  onRetain,
}: {
  project: ProjectDto;
  boardId: string;
  issues: IssueDto[] | undefined;
  selected: ReadonlySet<string>;
  onClear: () => void;
  /** Sau một lần ghi chỉ giữ chọn các id này (việc chưa xong để thử lại). */
  onRetain: (keep: ReadonlySet<string>) => void;
}) {
  const qc = useQueryClient();
  const { data: workflows } = useWorkflows();
  const { data: meta } = useProjectMeta(project.key);
  const { data: labels } = useProjectLabels(project.id);
  const { data: sprints } = useProjectSprints(project.id);
  const can = useProjectCan(project);
  const canEditIssue = useCanEditIssue(project.id);
  const currentUserId = useAuth((s) => s.user?.id);

  const bulk = useBulkEdit({
    projectId: project.id,
    boardId,
    // Bảng có bộ lọc JQL đọc `byBoard` — làm mới cùng cache dự án sau mỗi lần ghi.
    invalidate: () => void qc.invalidateQueries({ queryKey: keys.issues.byBoard(boardId) }),
    issues,
    selected,
    retainSelection: onRetain,
    workflows,
    sprints,
  });
  const selectedIssues = useMemo(
    () => (issues ?? []).filter((i) => selected.has(i.id)),
    [issues, selected],
  );
  const canEditAll = selectedIssues.every(canEditIssue);
  const statusOptions = useMemo(
    () => commonNextStatuses(workflows, selectedIssues),
    [workflows, selectedIssues],
  );

  return (
    <BulkDock
      placement="docked"
      count={selected.size}
      projectId={project.id}
      busy={bulk.busy}
      canAssign={can('issue:assign')}
      canManageBacklog={false}
      onAssignToMe={() => {
        if (currentUserId) void bulk.assign(currentUserId);
      }}
      onAssignTo={(userId) => void bulk.assign(userId)}
      onClear={onClear}
      canEdit={canEditAll}
      canTransition={can('issue:transition')}
      priorities={meta?.priorities ?? NO_PRIORITIES}
      labels={labels ?? NO_LABELS}
      statusOptions={statusOptions}
      onSetPoints={(points) => void bulk.setPoints(points)}
      onSetPriority={(id) => void bulk.setPriority(id)}
      onAddLabel={(id) => void bulk.addLabel(id)}
      onSetStatus={(id) => void bulk.setStatus(id)}
    />
  );
}
