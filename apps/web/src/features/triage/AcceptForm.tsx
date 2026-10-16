import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import type { TriageItemDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useProjectMeta } from '@/features/ai/api';
import { useProjectSprints } from '@/features/backlog/api';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import {
  buildAcceptPayload,
  defaultTypeKeyForKind,
  triageSprintOptions,
  type AcceptPayload,
} from './triageLogic';

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Form Nhận nội tuyến: Loại (mặc định theo loại yêu cầu người gửi chọn), Ưu tiên, Sprint, Người phụ trách.
 * Không đổi gì thì chỉ gửi `version` — giống Nhận một chạm. Esc đóng.
 */
export function AcceptForm({
  issue,
  projectKey,
  pending,
  onSubmit,
  onCancel,
}: {
  issue: TriageItemDto;
  projectKey: string;
  pending?: boolean;
  onSubmit: (payload: AcceptPayload) => void;
  onCancel: () => void;
}) {
  const { data: meta } = useProjectMeta(projectKey);
  const { data: sprints } = useProjectSprints(issue.projectId);
  const people = useAssigneeOptions(issue.projectId);

  const defaultTypeId = useMemo(() => {
    const key = defaultTypeKeyForKind(issue.kind);
    return (key && meta?.issueTypes.find((t) => t.key === key)?.id) || issue.type.id;
  }, [meta, issue.kind, issue.type.id]);

  const [typeId, setTypeId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState(issue.priority?.id ?? '');
  const [sprintId, setSprintId] = useState(issue.sprintId ?? '');
  const [assigneeId, setAssigneeId] = useState(issue.assignee?.id ?? '');
  const effectiveType = typeId ?? defaultTypeId;

  const typeOptions = (meta?.issueTypes ?? [])
    .filter((t) => !t.isSubtask)
    .map((t) => ({ value: t.id, label: t.name }));
  if (!typeOptions.some((o) => o.value === issue.type.id))
    typeOptions.push({ value: issue.type.id, label: issue.type.name });
  const priorityOptions = [
    { value: '', label: issue.priority ? 'Giữ nguyên' : 'Chưa đặt' },
    ...(meta?.priorities ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color })),
  ];
  const sprintOptions = triageSprintOptions(sprints);
  // Việc đang ở một sprint đã đóng/không còn trong danh sách: vẫn phải hiện đúng, không suy ra "Việc chờ".
  if (issue.sprintId && !sprintOptions.some((o) => o.value === issue.sprintId))
    sprintOptions.push({ value: issue.sprintId, label: 'Sprint hiện tại' });

  const submit = () =>
    onSubmit(
      buildAcceptPayload(
        {
          typeId: issue.type.id,
          priorityId: issue.priority?.id ?? null,
          sprintId: issue.sprintId,
          assigneeId: issue.assignee?.id ?? null,
          version: issue.version,
        },
        { typeId: effectiveType, priorityId, sprintId, assigneeId },
      ),
    );

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const id = `accept-${issue.id}`;
  return (
    <form
      className="rounded-md border border-border bg-bg p-3"
      aria-label={`Nhận ${issue.key} vào dự án`}
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loại" htmlFor={`${id}-type`}>
          <SearchSelect
            id={`${id}-type`}
            value={effectiveType}
            onChange={setTypeId}
            options={typeOptions}
            ariaLabel="Loại công việc"
          />
        </Field>
        <Field label="Ưu tiên" htmlFor={`${id}-priority`}>
          <SearchSelect
            id={`${id}-priority`}
            value={priorityId}
            onChange={setPriorityId}
            options={priorityOptions}
            ariaLabel="Ưu tiên"
          />
        </Field>
        <Field label="Sprint" htmlFor={`${id}-sprint`}>
          <SearchSelect
            id={`${id}-sprint`}
            value={sprintId}
            onChange={setSprintId}
            options={sprintOptions}
            ariaLabel="Sprint"
          />
        </Field>
        <Field label="Người phụ trách (tuỳ chọn)" htmlFor={`${id}-assignee`}>
          <PeoplePicker
            id={`${id}-assignee`}
            value={assigneeId}
            onChange={setAssigneeId}
            options={people}
            ariaLabel="Người phụ trách"
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-faint">Esc đóng</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          <Check className="h-4 w-4" />
          Nhận vào dự án
        </Button>
      </div>
    </form>
  );
}
