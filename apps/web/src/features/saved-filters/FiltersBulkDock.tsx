import { useMemo } from 'react';
import type { IssueDto } from '@tirapro/types';
import { BulkDock } from '@/features/bulk/BulkDock';
import { commonNextStatuses } from '@/features/bulk/bulkEdit';
import { useGroupedBulkEdit } from '@/features/bulk/useGroupedBulkEdit';
import type { PriorityChoice } from '@/features/backlog/InlineEdits';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectLabels, type ProjectLabel } from '@/features/issue-meta/api';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useAuth } from '@/stores/auth';

const NO_LABELS: ProjectLabel[] = [];
const NO_PRIORITIES: PriorityChoice[] = [];

/**
 * Dock hàng loạt của Bộ lọc. Chỉ mount khi đang có lựa chọn. Kết quả trải nhiều dự án nên hành động nào hiện, áp cho dự án
 * nào do `availableBulkActions` quyết (xem `useGroupedBulkEdit`): nhiều dự án chỉ còn Gán cho tôi / Ưu tiên / Điểm;
 * Đổi người, Nhãn, Trạng thái chỉ khi đang chọn trong đúng MỘT dự án. Không có Sprint/Epic.
 */
export function FiltersBulkDock({
  issues,
  selected,
  onClear,
  onRetain,
  projectKeyById,
}: {
  issues: IssueDto[] | null;
  selected: ReadonlySet<string>;
  onClear: () => void;
  onRetain: (keep: ReadonlySet<string>) => void;
  projectKeyById: ReadonlyMap<string, string>;
}) {
  const { data: workflows } = useWorkflows();
  const meId = useAuth((s) => s.user?.id);
  const bulk = useGroupedBulkEdit({
    issues: issues ?? undefined,
    selected,
    retainSelection: onRetain,
    workflows,
    projectKeyById,
  });
  const { groups, availability: av } = bulk;
  // Ưu tiên thuộc workspace → lấy từ meta của dự án đầu tiên; nhãn/trạng thái/người chỉ khi đúng một dự án.
  const single = groups.length === 1 ? groups[0]! : null;
  const { data: meta } = useProjectMeta(projectKeyById.get(groups[0]?.projectId ?? ''));
  const { data: labels } = useProjectLabels(av.label.visible ? single?.projectId : undefined);
  const statusOptions = useMemo(
    () => (single ? commonNextStatuses(workflows, single.issues) : []),
    [workflows, single],
  );

  return (
    <BulkDock
      placement="sticky"
      count={selected.size}
      projectId={single?.projectId ?? ''}
      busy={bulk.busy}
      canAssign={av.assignMe.visible}
      canManageBacklog={false}
      onAssignToMe={() => {
        if (meId) void bulk.assignMe(meId);
      }}
      onAssignTo={av.assign.visible ? (userId) => void bulk.assign(userId) : undefined}
      onClear={onClear}
      canEdit={av.priority.visible}
      canTransition={av.status.visible}
      priorities={meta?.priorities ?? NO_PRIORITIES}
      labels={labels ?? NO_LABELS}
      statusOptions={statusOptions}
      onSetPoints={(points) => void bulk.setPoints(points)}
      onSetPriority={(id) => void bulk.setPriority(id)}
      onAddLabel={av.label.visible ? (id) => void bulk.addLabel(id) : undefined}
      onSetStatus={av.status.visible ? (id) => void bulk.setStatus(id) : undefined}
    />
  );
}
