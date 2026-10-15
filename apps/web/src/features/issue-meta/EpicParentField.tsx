import { useMemo } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { InfoRow, INLINE_TRIGGER, PanelSection } from '@/features/issue-edit/IssueProperties';
import { useUpdateIssue, useProjectIssues } from '@/features/issues/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { epicChoices, epicIdOf, parentChoices } from '@/lib/epic';
import { isEpicIssue } from '@/lib/issueRefs';

const opt = (i: IssueDto) => ({ value: i.id, label: i.summary, hint: i.key, color: i.type.color });

/**
 * Mục "Epic / Việc cha": hai hàng chọn có tìm kiếm khớp đúng mô hình DB (`epicId` · `parentId`).
 * Epic không có mục này (cấp cao nhất); sub-task không có hàng Epic. Lỗi hợp lệ từ API (khác dự án, vòng…) hiện nguyên văn.
 */
export function EpicParentField({ issue }: { issue: IssueDto }) {
  const { data: issues = [] } = useProjectIssues(issue.projectId);
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  const epics = useMemo(() => epicChoices(issues, issue.id), [issues, issue.id]);
  const parents = useMemo(() => parentChoices(issues, issue.id), [issues, issue.id]);
  const byId = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);
  if (isEpicIssue(issue)) return null; // sau mọi hook (quy tắc hook)

  const parent = issue.parentId ? byId.get(issue.parentId) : undefined;
  // Con trực tiếp của một epic (tạo bằng "Tạo việc con" ở trang epic): hàng Việc cha để trống, hàng Epic hiện epic đó.
  const parentIsEpic = !!parent && isEpicIssue(parent);
  const epicValue = epicIdOf(issue, byId) ?? '';
  const parentValue = parentIsEpic ? '' : (issue.parentId ?? '');

  function save(field: 'epicId' | 'parentId', next: string | null) {
    if (next === ((field === 'epicId' ? epicValue : parentValue) || null)) return;
    const body: Record<string, string | null> = { [field]: next };
    const restore: Record<string, string | null> = { [field]: issue[field] };
    // Đặt epic cho việc đang là con trực tiếp của một epic: gỡ luôn parentId để không thuộc hai epic cùng lúc.
    if (field === 'epicId' && parentIsEpic) {
      body.parentId = null;
      restore.parentId = issue.parentId;
    }
    const target = byId.get(next ?? '')?.key ?? '';
    patch.mutate(
      { id: issue.id, key: issue.key, patch: body, version: issue.version },
      {
        onSuccess: (res) =>
          toast.success(
            next
              ? `Đã gắn ${issue.key} vào ${target}`
              : `Đã gỡ ${issue.key} khỏi ${field === 'epicId' ? 'epic' : 'việc cha'}`,
            {
              duration: 6000,
              action: {
                label: 'Hoàn tác',
                onClick: () =>
                  patch.mutate(
                    { id: issue.id, key: issue.key, patch: restore, version: res.data.version },
                    { onError: (e) => toast.error(apiErrorMessage(e)) },
                  ),
              },
            },
          ),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <PanelSection title="Epic / Việc cha">
      <div className="divide-y divide-border">
        {!issue.type.isSubtask && (
          <InfoRow
            label="Epic"
            hint="Mảng lớn mà công việc này thuộc về — tiến độ epic tính theo điểm các việc bên trong"
          >
            <SearchSelect
              ariaLabel="Epic"
              value={epicValue}
              disabled={!canEdit || patch.isPending}
              options={[{ value: '', label: 'Không thuộc epic' }, ...epics.map(opt)]}
              searchPlaceholder="Tìm epic theo mã hoặc tiêu đề…"
              onChange={(v) => save('epicId', v || null)}
              className={INLINE_TRIGGER}
            />
          </InfoRow>
        )}
        <InfoRow label="Việc cha" hint="Công việc lớn hơn mà việc này là một phần của nó">
          <SearchSelect
            ariaLabel="Việc cha"
            value={parentValue}
            disabled={!canEdit || patch.isPending}
            options={[{ value: '', label: 'Không có việc cha' }, ...parents.map(opt)]}
            searchPlaceholder="Tìm việc cha theo mã hoặc tiêu đề…"
            onChange={(v) => save('parentId', v || null)}
            className={INLINE_TRIGGER}
          />
        </InfoRow>
      </div>
    </PanelSection>
  );
}
