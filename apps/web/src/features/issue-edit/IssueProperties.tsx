import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { useProjectSprints, useMoveToSprint } from '@/features/backlog/api';
import { BACKLOG_LABEL, buildSprintOptions } from './sprintOptions';
import { useUpdateIssue } from '@/features/issues/api';
import { pointsConfirmOptions, pointsEditWarning } from '@/features/issues/pointsWarning';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import { ParticipantsRow } from '@/features/issue-extras/ParticipantsRow';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { AssigneeSuggestButton } from '@/features/ai/AssigneeSuggestButton';
import { useAuth } from '@/stores/auth';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/primitives';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { usePriorityRanks } from '@/features/issue-meta/usePriorityRanks';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { isBugType } from './severity';
import { dueState } from '@/lib/dueDate';
import { apiErrorMessage } from '@/lib/api';
import { parsePointsInput } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDateTime, fmtRelative, toDateInput, toDateTimeInput } from '@/lib/dateFormat';
import { DateInput, DateTimeInput } from '@/components/ui/DateInput';
import type { FactField } from '@/features/issues/issueFacts';

/** Trigger SearchSelect ở dạng badge/label (không viền, hover nền) — bấm để đổi. */
export const INLINE_TRIGGER =
  'inline-flex h-auto w-auto gap-1 border-transparent bg-transparent px-1 py-0.5 hover:bg-surface-2 [@media(pointer:coarse)]:min-h-9';

/** Khung 1 mục (tiêu đề + gạch chân) — không phải card có viền. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold text-ink-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Hàng nhãn:giá trị (chỉ đọc / control inline). `hint` = giải nghĩa nhãn khi rê chuột. */
export function InfoRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted" title={hint}>
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  );
}

/** Badge mức ưu tiên (tô theo màu ưu tiên). */
function PriorityBadge({ priority }: { priority: IssueDto['priority'] }) {
  const ranks = usePriorityRanks();
  if (!priority)
    return (
      <span className="text-sm text-faint" title="Chưa đặt mức ưu tiên. Bấm để chọn.">
        —
      </span>
    );
  const c = priority.color || 'var(--faint)';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
      title={`Mức ưu tiên: ${priority.name}. Bấm để đổi.`}
    >
      <PriorityIcon
        withLabel
        name={priority.name}
        rank={priority.rank}
        ranks={ranks}
        color={c}
        title={`Mức ưu tiên: ${priority.name}. Bấm để đổi.`}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Loại & Ưu tiên — badge chọn được, đặt cạnh tiêu đề                  */
/* ------------------------------------------------------------------ */

/** Badge LOẠI VIỆC (đứng trước tiêu đề), bấm để đổi. */
export function IssueTypeSelect({ issue }: { issue: IssueDto }) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  if (!canEdit) {
    return (
      <span title={`Loại việc: ${issue.type.name}`}>
        <IssueTypeBadge name={issue.type.name} color={issue.type.color} />
      </span>
    );
  }
  return (
    <SearchSelect
      ariaLabel="Loại việc"
      value={issue.type.id}
      disabled={patch.isPending}
      options={(meta?.issueTypes ?? []).map((t) => ({
        value: t.id,
        label: t.name,
        color: t.color,
      }))}
      onChange={(v) => {
        if (v === issue.type.id) return;
        patch.mutate(
          { id: issue.id, key: issue.key, patch: { typeId: v }, version: issue.version },
          { onError: (e) => toast.error(apiErrorMessage(e)) },
        );
      }}
      className={INLINE_TRIGGER}
      renderTrigger={() => (
        <span title={`Loại việc: ${issue.type.name}. Bấm để đổi.`}>
          <IssueTypeBadge name={issue.type.name} color={issue.type.color} />
        </span>
      )}
    />
  );
}

/** Badge ƯU TIÊN (đứng sau loại), bấm để đổi. */
export function IssuePrioritySelect({
  issue,
  className,
}: {
  issue: IssueDto;
  /** Ghi thêm lên nút (vd `min-h-11` cho dải thuộc tính trên điện thoại). */
  className?: string;
}) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  if (!canEdit) return <PriorityBadge priority={issue.priority} />;
  return (
    <SearchSelect
      ariaLabel="Ưu tiên"
      value={issue.priority?.id ?? ''}
      disabled={patch.isPending}
      options={[
        { value: '', label: '—' },
        ...(meta?.priorities ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color })),
      ]}
      onChange={(v) => {
        const next = v || null;
        if (next === (issue.priority?.id ?? null)) return;
        patch.mutate(
          { id: issue.id, key: issue.key, patch: { priorityId: next }, version: issue.version },
          { onError: (e) => toast.error(apiErrorMessage(e)) },
        );
      }}
      className={cn(INLINE_TRIGGER, className)}
      renderTrigger={() => <PriorityBadge priority={issue.priority} />}
    />
  );
}

/**
 * Mức nghiêm trọng (chỉ Bug), đặt cạnh Ưu tiên. Trống: người sửa được thấy nút mờ "Đặt mức nghiêm trọng", người chỉ xem thì không thấy gì.
 * Vá lạc quan kèm đối tượng `severity` tra từ meta để huy hiệu đổi tức thì; bản thật về sau thay thế.
 */
export function IssueSeveritySelect({ issue }: { issue: IssueDto }) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  if (!isBugType(issue.type)) return null;
  if (!canEdit) return <SeverityBadge severity={issue.severity} />;
  const severities = meta?.severities ?? [];
  return (
    <SearchSelect
      ariaLabel="Mức nghiêm trọng"
      value={issue.severity?.id ?? ''}
      disabled={patch.isPending}
      options={[
        { value: '', label: '—' },
        ...severities.map((s) => ({ value: s.id, label: s.name, color: s.color })),
      ]}
      onChange={(v) => {
        const next = v || null;
        if (next === (issue.severity?.id ?? null)) return;
        const found = severities.find((s) => s.id === next);
        patch.mutate(
          {
            id: issue.id,
            key: issue.key,
            patch: { severityId: next },
            version: issue.version,
            optimistic: { severity: found ?? null },
          },
          { onError: (e) => toast.error(apiErrorMessage(e)) },
        );
      }}
      className={INLINE_TRIGGER}
      renderTrigger={() =>
        issue.severity ? (
          <SeverityBadge severity={issue.severity} suffix="Bấm để đổi." />
        ) : (
          <span
            className="text-xs text-faint"
            title="Chưa đặt mức nghiêm trọng. Mức nghiêm trọng = lỗi gây hại kỹ thuật đến đâu; khác với Ưu tiên (độ gấp xử lý). Bấm để chọn."
          >
            Đặt mức nghiêm trọng
          </span>
        )
      }
    />
  );
}

/** Chip "Giải quyết: Done" (chỉ đọc hoặc làm nút bấm đổi). */
function ResolutionChip({ name, hint }: { name: string; hint: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-border"
      title={hint}
    >
      <span className="text-faint">Giải quyết:</span> {name}
    </span>
  );
}

/**
 * Cách giải quyết — chỉ hiện khi trạng thái thuộc nhóm Done (rời Done thì máy chủ xoá nên ẩn).
 * Chọn lại được ở đây để sửa giá trị gán ngầm (kéo thẻ board sang Done nhận mặc định "Done").
 * Có "Hoàn tác" sau khi đổi; người không có quyền sửa / dự án lưu trữ chỉ thấy chip.
 */
export function IssueResolutionSelect({ issue }: { issue: IssueDto }) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  if (issue.status.category !== 'DONE') return null;
  const resolutions = meta?.resolutions ?? [];
  const current = issue.resolution;
  if (!canEdit)
    return current ? (
      <ResolutionChip name={current.name} hint={`Cách giải quyết: ${current.name}`} />
    ) : null;

  function apply(nextId: string, version: number, prev: IssueDto['resolution'], undoable: boolean) {
    const found = resolutions.find((r) => r.id === nextId);
    patch.mutate(
      {
        id: issue.id,
        key: issue.key,
        patch: { resolutionId: nextId },
        version,
        optimistic: {
          resolution: found
            ? { id: found.id, name: found.name, description: found.description, rank: found.rank }
            : null,
        },
      },
      {
        onSuccess: (res) => {
          if (!undoable || !prev) return;
          toast.success(`Cách giải quyết: ${found?.name ?? ''}`, {
            duration: 4000,
            action: {
              label: 'Hoàn tác',
              onClick: () => apply(prev.id, res.data.version, null, false),
            },
          });
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <SearchSelect
      ariaLabel="Cách giải quyết"
      value={current?.id ?? ''}
      disabled={patch.isPending}
      options={resolutions.map((r) => ({ value: r.id, label: r.name }))}
      onChange={(v) => {
        if (!v || v === current?.id) return;
        apply(v, issue.version, current, true);
      }}
      className={INLINE_TRIGGER}
      renderTrigger={() =>
        current ? (
          <ResolutionChip
            name={current.name}
            hint={`Cách giải quyết: ${current.name}${current.description ? ` — ${current.description}` : ''}. Bấm để đổi.`}
          />
        ) : (
          <span className="text-xs text-faint" title="Chưa đặt cách giải quyết. Bấm để chọn.">
            Đặt cách giải quyết
          </span>
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Sprint & điểm ước lượng — dòng phụ (subtitle) dưới tiêu đề         */
/* ------------------------------------------------------------------ */

/** Sprint dạng label mờ, bấm để đổi. */
export function IssueSprintSubtitle({ issue }: { issue: IssueDto }) {
  const { data: sprints } = useProjectSprints(issue.projectId);
  const moveToSprint = useMoveToSprint(issue.projectId);
  const canEdit = useCanEditIssue(issue.projectId)(issue);

  const sprintOptions = useMemo(
    () => buildSprintOptions(sprints, issue.sprintId ?? null),
    [sprints, issue.sprintId],
  );

  if (!canEdit) {
    const current = sprintOptions.find((o) => o.value === (issue.sprintId ?? ''));
    return (
      <span className="truncate text-sm text-muted" title="Sprint chứa việc này">
        {current?.label ?? BACKLOG_LABEL}
      </span>
    );
  }
  return (
    <SearchSelect
      ariaLabel="Sprint chứa việc này"
      value={issue.sprintId ?? ''}
      disabled={moveToSprint.isPending}
      options={sprintOptions}
      className={`${INLINE_TRIGGER} -ml-1 text-sm text-muted`}
      renderTrigger={(sel) => (
        <span
          className="truncate"
          title="Sprint: khoảng thời gian làm việc ngắn, thường 1–2 tuần. Bấm để chuyển việc sang sprint khác."
        >
          {sel?.label ?? BACKLOG_LABEL}
        </span>
      )}
      onChange={(v) => {
        const next = v || null;
        if (next === (issue.sprintId ?? null)) return;
        const nextName = sprintOptions.find((o) => o.value === v)?.label;
        moveToSprint.mutate(
          { id: issue.id, sprintId: next, version: issue.version },
          {
            onSuccess: () =>
              toast.success(
                next ? `Đã chuyển sang ${nextName ?? 'sprint đã chọn'}` : 'Đã đưa về Việc chờ',
                { duration: 1800 },
              ),
            onError: (e) => toast.error(apiErrorMessage(e)),
          },
        );
      }}
    />
  );
}

/** Điểm ước lượng dạng label mờ ("N điểm"), bấm mới sửa; khoá nếu không có quyền. */
export function IssueStoryPointsInline({ issue, canEdit }: { issue: IssueDto; canEdit: boolean }) {
  const patch = useUpdateIssue(issue.projectId);
  const { data: sprints } = useProjectSprints(issue.projectId);
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);

  async function save(raw: string) {
    setEditing(false);
    const r = parsePointsInput(raw); // MỘT luật cho mọi nơi nhập điểm (dòng Việc chờ, hàng loạt, trang công việc)
    if (!r.ok) return toast.error(r.error);
    const next = r.value;
    if (next !== issue.storyPoints) {
      const w = pointsEditWarning(issue, sprints);
      if (w && !(await confirm(pointsConfirmOptions(w)))) return;
      patch.mutate(
        { id: issue.id, key: issue.key, patch: { storyPoints: next }, version: issue.version },
        { onError: (e) => toast.error(apiErrorMessage(e)) },
      );
    }
  }

  if (editing && canEdit) {
    return (
      <Input
        type="number"
        min={0}
        max={1000}
        step="any"
        inputMode="decimal"
        autoFocus
        className="h-6 w-16 text-sm"
        aria-label="Điểm ước lượng"
        defaultValue={issue.storyPoints ?? ''}
        disabled={patch.isPending}
        onBlur={(e) => void save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.preventDefault(); // huỷ sửa ô này thôi — panel xem nhanh không đóng theo
            setEditing(false);
          }
        }}
      />
    );
  }

  const text = issue.storyPoints != null ? `${issue.storyPoints} điểm` : null;
  const tip = 'Điểm ước lượng — con số ước chừng độ lớn của việc, càng lớn càng tốn công.';
  if (!canEdit) {
    return (
      <span className="text-sm text-muted" title={`${tip} Bạn không có quyền sửa công việc này.`}>
        {text ?? '—'}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={`${tip} Bấm để đặt lại.`}
      className="-mx-1 rounded px-1 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-9"
    >
      {text ?? <span className="text-faint">Đặt điểm ước lượng</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Người liên quan (cột phải — người phụ trách / người tạo / tham gia) */
/* ------------------------------------------------------------------ */

/**
 * Người phụ trách: nút gợi ý AI (nếu có quyền) + ô chọn người (hoặc chữ thường khi chỉ xem). MỘT nơi định nghĩa cho cả
 * hàng ở cột phải và ô trong dải thuộc tính (điện thoại) → cùng quyền, cùng `version` (OCC), cùng thông báo lỗi.
 */
export function IssueAssigneeControl({
  issue,
  className,
  suggestClassName,
}: {
  issue: IssueDto;
  /** Ghi thêm lên nút chọn (vd `min-h-11 max-w-full`). */
  className?: string;
  /** Ghi thêm lên nút "Gợi ý". */
  suggestClassName?: string;
}) {
  const assignees = useAssigneePicker(issue.projectId);
  const patch = useUpdateIssue(issue.projectId);
  const canEditThis = useCanEditIssue(issue.projectId)(issue);
  const canSuggest = useAuth((s) => s.can('ai:use')) && canEditThis;
  return (
    <div className="flex min-w-0 items-center gap-1">
      {canSuggest && (
        <AssigneeSuggestButton
          projectId={issue.projectId}
          issueId={issue.id}
          disabled={patch.isPending}
          className={suggestClassName}
          onPick={(userId) => {
            if (userId === (issue.assignee?.id ?? null)) return;
            patch.mutate(
              {
                id: issue.id,
                key: issue.key,
                patch: { assigneeId: userId },
                version: issue.version,
              },
              { onError: (e) => toast.error(apiErrorMessage(e)) },
            );
          }}
        />
      )}
      {canEditThis ? (
        <PeoplePicker
          ariaLabel="Người phụ trách"
          value={issue.assignee?.id ?? ''}
          disabled={patch.isPending}
          align="end"
          {...assignees}
          selectedFallback={issue.assignee ?? undefined}
          onChange={(v) => {
            const next = v || null;
            if (next !== (issue.assignee?.id ?? null)) {
              patch.mutate(
                {
                  id: issue.id,
                  key: issue.key,
                  patch: { assigneeId: next },
                  version: issue.version,
                },
                { onError: (e) => toast.error(apiErrorMessage(e)) },
              );
            }
          }}
          className={cn(INLINE_TRIGGER, 'justify-end', className)}
          renderTrigger={() =>
            issue.assignee ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar
                  name={issue.assignee.displayName}
                  src={issue.assignee.avatarUrl}
                  size={18}
                />
                <span className="truncate">{issue.assignee.displayName}</span>
              </span>
            ) : (
              <span
                className="text-faint"
                title="Chưa có ai nhận việc này. Bấm để chọn người phụ trách."
              >
                Chưa gán
              </span>
            )
          }
        />
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          {issue.assignee ? (
            <>
              <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={18} />
              <span className="truncate">{issue.assignee.displayName}</span>
            </>
          ) : (
            <span className="text-faint">Chưa gán</span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Cột phải: người phụ trách / người tạo / tham gia. `omit` = trường đã hiện ở nơi khác trên trang (dải thuộc tính ở điện
 * thoại) → không dựng lại ở đây; bỏ hết thì không vẽ cả mục.
 */
export function IssuePeoplePanel({
  issue,
  omit = [],
}: {
  issue: IssueDto;
  omit?: readonly FactField[];
}) {
  const show = (f: FactField) => !omit.includes(f);
  if (!show('assignee') && !show('reporter') && !show('participants')) return null;
  return (
    <PanelSection title="Người liên quan">
      <div className="divide-y divide-border">
        {/* Người phụ trách — inline, bấm để chọn */}
        {show('assignee') && (
          <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="shrink-0 text-muted" title="Người chịu trách nhiệm làm xong việc này">
              Người phụ trách
            </span>
            <IssueAssigneeControl issue={issue} />
          </div>
        )}

        {show('reporter') && (
          <InfoRow
            label="Người tạo"
            hint="Người đã tạo công việc này — thường là người cần kết quả"
          >
            {issue.reporter ? (
              <span className="flex items-center justify-end gap-1.5">
                <Avatar
                  name={issue.reporter.displayName}
                  src={issue.reporter.avatarUrl}
                  size={18}
                />
                <span className="truncate">{issue.reporter.displayName}</span>
              </span>
            ) : (
              '—'
            )}
          </InfoRow>
        )}

        {/* Người tham gia — nhiều người cùng theo việc này (ngoài người phụ trách và người tạo). */}
        {show('participants') && (
          <ParticipantsRow issueId={issue.id} projectId={issue.projectId} owner={issue} />
        )}
      </div>
    </PanelSection>
  );
}

/* ------------------------------------------------------------------ */
/* Mốc thời gian (cột phải — Bắt đầu / Hạn / Tạo / Cập nhật / Hoàn tất) */
/* ------------------------------------------------------------------ */

export function IssueDatesPanel({
  issue,
  canEditRestricted,
  omit = [],
}: {
  issue: IssueDto;
  canEditRestricted: boolean;
  /** Trường đã hiện ở nơi khác trên trang (xem `IssuePeoplePanel`). */
  omit?: readonly FactField[];
}) {
  const show = (f: FactField) => !omit.includes(f);
  return (
    <PanelSection title="Mốc thời gian">
      <div className="divide-y divide-border">
        {show('startDate') && <StartRow issue={issue} canEdit={canEditRestricted} />}
        {show('due') && <IssueDueField issue={issue} canEdit={canEditRestricted} />}
        {show('createdAt') && (
          <InfoRow label="Ngày tạo" hint="Lúc công việc được tạo">
            <span title={fmtRelative(issue.createdAt)}>{fmtDateTime(issue.createdAt)}</span>
          </InfoRow>
        )}
        {show('updatedAt') && (
          <InfoRow label="Sửa lần cuối" hint="Lần gần nhất có người thay đổi việc này">
            <span title={fmtRelative(issue.updatedAt)}>{fmtDateTime(issue.updatedAt)}</span>
          </InfoRow>
        )}
        {show('resolvedAt') && issue.resolvedAt && (
          <InfoRow label="Hoàn tất" hint="Lúc công việc chuyển sang trạng thái đã xong">
            <span title={fmtRelative(issue.resolvedAt)}>{fmtDateTime(issue.resolvedAt)}</span>
          </InfoRow>
        )}
      </div>
    </PanelSection>
  );
}

/**
 * Khung chung của hàng ngày sửa-tại-chỗ ("Ngày bắt đầu", "Hạn"): nhãn (+ khoá khi không có quyền), giá trị bấm mới sửa,
 * ô sửa do bên gọi cấp. Cùng luật quyền (`canEdit` = `useCanEditSchedule`) nên hai hàng khoá/mở đồng nhất.
 */
function DateRowShell({
  label,
  hint,
  lockedTip,
  canEdit,
  editing,
  editor,
  display,
  emptyAction,
  valueClass,
  valueTip,
  onEdit,
  layout = 'row',
}: {
  label: string;
  hint: string;
  lockedTip: string;
  canEdit: boolean;
  editing: boolean;
  editor: ReactNode;
  display: string | null;
  /** Chữ nút khi chưa có ngày ("Đặt hạn"). */
  emptyAction: string;
  valueClass?: string;
  valueTip?: string | null;
  onEdit: () => void;
  /** `row` = hàng nhãn:giá trị ở cột phải; `tile` = ô trong dải thuộc tính (nhãn do khung ngoài vẽ, vùng bấm ≥ 44px). */
  layout?: 'row' | 'tile';
}) {
  if (layout === 'tile') {
    const shown = display ?? (canEdit ? emptyAction : '—');
    return (
      <div className="flex min-h-11 min-w-0 items-center gap-1 text-sm">
        {!canEdit && <Lock className="h-3 w-3 shrink-0 text-faint" aria-label={lockedTip} />}
        {editing && canEdit ? (
          <div className="min-w-0 flex-1">{editor}</div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${label}: ${shown}`}
            title={
              valueTip ? `${valueTip} — bấm để đổi` : `Bấm để đặt hoặc đổi ${label.toLowerCase()}`
            }
            className={cn(
              'min-h-11 min-w-0 rounded px-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              display ? valueClass : 'text-faint',
            )}
          >
            {shown}
          </button>
        ) : (
          <span
            className={cn('min-w-0 rounded px-1.5 py-0.5', display ? valueClass : 'text-ink')}
            title={valueTip ?? (display ? undefined : `Việc này chưa đặt ${label.toLowerCase()}`)}
          >
            {shown}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex shrink-0 items-center gap-1 text-muted" title={hint}>
        {label}
        {!canEdit && <Lock className="h-3 w-3 text-faint" aria-label={lockedTip} />}
      </span>
      {editing && canEdit ? (
        editor
      ) : canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          title={
            valueTip ? `${valueTip} — bấm để đổi` : `Bấm để đặt hoặc đổi ${label.toLowerCase()}`
          }
          className={cn(
            'rounded px-1.5 py-0.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-9',
            display ? valueClass : 'text-faint',
          )}
        >
          {display ?? emptyAction}
        </button>
      ) : (
        <span
          className={cn('rounded px-1.5 py-0.5', display ? valueClass : 'text-ink')}
          title={valueTip ?? (display ? undefined : `Việc này chưa đặt ${label.toLowerCase()}`)}
        >
          {display ?? '—'}
        </span>
      )}
    </div>
  );
}

/**
 * Khung ô sửa-tại-chỗ cho DateInput/DateTimeInput (không có autoFocus): đưa con trỏ vào ô chữ đầu tiên để rời ô mới
 * "chốt" được giá trị, và Esc chỉ huỷ ô này (panel xem nhanh không đóng theo).
 */
function InlineEditor({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Hàng "Ngày bắt đầu": chỉ ngày (Gantt chỉ xét ngày), gõ/chọn dd/MM/yyyy; server từ chối bắt đầu sau hạn. */
function StartRow({ issue, canEdit }: { issue: IssueDto; canEdit: boolean }) {
  const patch = useUpdateIssue(issue.projectId);
  const [editing, setEditing] = useState(false);
  const current = issue.startDate ? toDateInput(issue.startDate) : '';
  const [draft, setDraft] = useState(current);

  function save(iso: string) {
    setEditing(false);
    if (iso === current) return;
    patch.mutate(
      {
        id: issue.id,
        key: issue.key,
        // Ngày thuần theo giờ địa phương: 00:00 của ngày chọn.
        patch: { startDate: iso ? new Date(`${iso}T00:00`).toISOString() : null },
        version: issue.version,
      },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  return (
    <DateRowShell
      label="Ngày bắt đầu"
      hint="Ngày bắt đầu làm việc này — cùng Hạn tạo thanh nhiều ngày trên Gantt"
      lockedTip="Chỉ người tạo việc hoặc quản trị mới sửa được ngày bắt đầu"
      canEdit={canEdit}
      editing={editing}
      display={issue.startDate ? fmtDate(issue.startDate) : null}
      emptyAction="Đặt ngày bắt đầu"
      valueClass="text-ink"
      onEdit={() => {
        setDraft(current);
        setEditing(true);
      }}
      editor={
        <InlineEditor onCancel={() => setEditing(false)}>
          <DateInput
            value={draft}
            onChange={setDraft}
            onCommit={save}
            ariaLabel="Ngày bắt đầu"
            disabled={patch.isPending}
            className="h-8 w-40 text-sm"
          />
        </InlineEditor>
      }
    />
  );
}

/**
 * "Hạn": nhãn ngày, bấm mới sửa (khoá nếu không có quyền). Dùng cho hàng ở cột phải (`row`) và ô ở dải thuộc tính trên
 * điện thoại (`tile`) — cùng quyền (`canEdit`), cùng ô sửa, cùng mutation + `version`.
 */
export function IssueDueField({
  issue,
  canEdit,
  layout = 'row',
}: {
  issue: IssueDto;
  canEdit: boolean;
  layout?: 'row' | 'tile';
}) {
  const patch = useUpdateIssue(issue.projectId);
  const [editing, setEditing] = useState(false);
  const display = issue.dueDate ? fmtDateTime(issue.dueDate) : null;
  const currentDue = issue.dueDate ? toDateTimeInput(issue.dueDate) : '';
  const [draft, setDraft] = useState(currentDue);

  // Màu theo hạn: quá hạn = đỏ đậm nổi bật, sắp đến hạn = vàng, còn lại = bình thường.
  const st = dueState(issue);
  const toneCls =
    st === 'overdue'
      ? 'bg-danger/10 font-semibold text-danger'
      : st === 'soon'
        ? 'font-medium text-warning'
        : 'text-ink';
  // Giải nghĩa màu cho người mới: vì sao ngày này lại đỏ / vàng.
  const toneTip =
    st === 'overdue'
      ? 'Đã quá hạn mà việc chưa xong'
      : st === 'soon'
        ? 'Sắp tới hạn (còn không quá 2 ngày)'
        : null;

  function save(raw: string) {
    setEditing(false);
    const cur = issue.dueDate ? toDateTimeInput(issue.dueDate) : '';
    if (raw === cur) return;
    patch.mutate(
      {
        id: issue.id,
        key: issue.key,
        patch: { dueDate: raw ? new Date(raw).toISOString() : null },
        version: issue.version,
      },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  return (
    <DateRowShell
      label="Hạn"
      hint="Mốc việc này phải xong"
      lockedTip="Chỉ người tạo việc hoặc quản trị mới sửa được hạn"
      canEdit={canEdit}
      editing={editing}
      display={display}
      emptyAction="Đặt hạn"
      valueClass={toneCls}
      valueTip={toneTip}
      layout={layout}
      onEdit={() => {
        setDraft(currentDue);
        setEditing(true);
      }}
      editor={
        <InlineEditor onCancel={() => setEditing(false)}>
          <DateTimeInput
            value={draft}
            onChange={setDraft}
            onCommit={save}
            ariaLabel="Hạn hoàn thành"
            disabled={patch.isPending}
            className={layout === 'tile' ? 'w-full' : 'w-56'}
          />
        </InlineEditor>
      }
    />
  );
}
