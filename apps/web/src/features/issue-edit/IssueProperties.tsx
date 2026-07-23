import { useMemo, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { useProjectSprints, useMoveToSprint } from '@/features/backlog/api';
import { useUpdateIssue } from '@/features/issues/api';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/primitives';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { dueState } from '@/components/ui/DueBadge';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Trigger SearchSelect ở dạng badge/label (không viền, hover nền) — bấm để đổi. */
const INLINE_TRIGGER =
  'inline-flex h-auto w-auto gap-1 border-transparent bg-transparent px-1 py-0.5 hover:bg-surface-2';

/** Khung 1 mục (tiêu đề + gạch chân) — kiểu Jira, không phải card có viền. */
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold text-ink-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Hàng nhãn:giá trị (chỉ đọc / control inline) — dùng cho People / Dates. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  );
}

/** Badge độ ưu tiên (tô theo màu ưu tiên). */
function PriorityBadge({ priority }: { priority: IssueDto['priority'] }) {
  if (!priority) return <span className="text-sm text-faint">—</span>;
  const c = priority.color || 'var(--faint)';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} aria-hidden />
      {priority.name}
    </span>
  );
}

/** Ngày giờ chi tiết tới phút: dd/MM/yyyy HH:mm. */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** ISO → giá trị input datetime-local (giờ địa phương): YYYY-MM-DDTHH:mm. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

/* ------------------------------------------------------------------ */
/* Loại & Ưu tiên — badge chọn được, đặt cạnh tiêu đề                  */
/* ------------------------------------------------------------------ */

/** Badge LOẠI (đứng trước tiêu đề), bấm để đổi. */
export function IssueTypeSelect({ issue }: { issue: IssueDto }) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  return (
    <SearchSelect
      ariaLabel="Loại"
      value={issue.type.id}
      disabled={patch.isPending}
      options={(meta?.issueTypes ?? []).map((t) => ({ value: t.id, label: t.name, color: t.color }))}
      onChange={(v) => {
        if (v === issue.type.id) return;
        patch.mutate(
          { id: issue.id, key: issue.key, patch: { typeId: v }, version: issue.version },
          { onError: (e) => toast.error(apiErrorMessage(e)) },
        );
      }}
      className={INLINE_TRIGGER}
      renderTrigger={() => <IssueTypeBadge name={issue.type.name} color={issue.type.color} />}
    />
  );
}

/** Badge ƯU TIÊN (đứng sau loại), bấm để đổi. */
export function IssuePrioritySelect({ issue }: { issue: IssueDto }) {
  const { data: projects } = useProjects();
  const projectKey = projects?.find((p) => p.id === issue.projectId)?.key;
  const { data: meta } = useProjectMeta(projectKey);
  const patch = useUpdateIssue(issue.projectId);
  return (
    <SearchSelect
      ariaLabel="Ưu tiên"
      value={issue.priority?.id ?? ''}
      disabled={patch.isPending}
      options={[{ value: '', label: '—' }, ...(meta?.priorities ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color }))]}
      onChange={(v) => {
        const next = v || null;
        if (next === (issue.priority?.id ?? null)) return;
        patch.mutate(
          { id: issue.id, key: issue.key, patch: { priorityId: next }, version: issue.version },
          { onError: (e) => toast.error(apiErrorMessage(e)) },
        );
      }}
      className={INLINE_TRIGGER}
      renderTrigger={() => <PriorityBadge priority={issue.priority} />}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Sprint & Story points — dòng phụ (subtitle) dưới tiêu đề           */
/* ------------------------------------------------------------------ */

/** Sprint dạng label mờ, bấm để đổi. */
export function IssueSprintSubtitle({ issue }: { issue: IssueDto }) {
  const { data: sprints } = useProjectSprints(issue.projectId);
  const moveToSprint = useMoveToSprint(issue.projectId);

  const sprintOptions = useMemo(
    () => [
      { value: '', label: 'Backlog (không sprint)' },
      ...(sprints ?? [])
        .filter((s) => s.state !== 'CLOSED')
        .map((s) => ({ value: s.id, label: s.state === 'ACTIVE' ? `${s.name} · đang chạy` : s.name })),
    ],
    [sprints],
  );

  return (
    <SearchSelect
      ariaLabel="Sprint"
      value={issue.sprintId ?? ''}
      disabled={moveToSprint.isPending}
      options={sprintOptions}
      className={`${INLINE_TRIGGER} -ml-1 text-sm text-muted`}
      renderTrigger={(sel) => <span className="truncate">{sel?.label ?? 'Backlog (không sprint)'}</span>}
      onChange={(v) => {
        const next = v || null;
        if (next === (issue.sprintId ?? null)) return;
        moveToSprint.mutate(
          { id: issue.id, sprintId: next, version: issue.version },
          {
            onSuccess: () => toast.success(next ? 'Đã chuyển sprint' : 'Đã đưa về backlog', { duration: 1800 }),
            onError: (e) => toast.error(apiErrorMessage(e)),
          },
        );
      }}
    />
  );
}

/** Story points dạng label mờ ("N điểm"), bấm mới sửa; khoá nếu không có quyền. */
export function IssueStoryPointsInline({ issue, canEditRestricted }: { issue: IssueDto; canEditRestricted: boolean }) {
  const patch = useUpdateIssue(issue.projectId);
  const [editing, setEditing] = useState(false);

  function save(raw: string) {
    setEditing(false);
    const next = raw.trim() === '' ? null : Number(raw);
    if (next !== null && Number.isNaN(next)) return toast.error('Story points phải là số');
    if (next !== issue.storyPoints) {
      patch.mutate(
        { id: issue.id, key: issue.key, patch: { storyPoints: next }, version: issue.version },
        { onError: (e) => toast.error(apiErrorMessage(e)) },
      );
    }
  }

  if (editing && canEditRestricted) {
    return (
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        autoFocus
        className="h-6 w-16 text-sm"
        defaultValue={issue.storyPoints ?? ''}
        disabled={patch.isPending}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  const text = issue.storyPoints != null ? `${issue.storyPoints} điểm` : null;
  if (!canEditRestricted) {
    return <span className="text-sm text-muted" title="Chỉ người tạo hoặc quản trị được sửa">{text ?? '—'}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="-mx-1 rounded px-1 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {text ?? <span className="text-faint">Đặt điểm</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Con người (cột phải — Assignee / Reporter / Theo dõi)              */
/* ------------------------------------------------------------------ */

export function IssuePeoplePanel({ issue }: { issue: IssueDto }) {
  const assignees = useAssigneeOptions(issue.projectId);
  const patch = useUpdateIssue(issue.projectId);

  return (
    <PanelSection title="Con người">
      <div className="divide-y divide-border">
        {/* Người phụ trách — inline, bấm để chọn (giống Người báo cáo) */}
        <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="shrink-0 text-muted">Người phụ trách</span>
          <PeoplePicker
            ariaLabel="Người phụ trách"
            value={issue.assignee?.id ?? ''}
            disabled={patch.isPending}
            align="end"
            options={assignees}
            onChange={(v) => {
              const next = v || null;
              if (next !== (issue.assignee?.id ?? null)) {
                patch.mutate(
                  { id: issue.id, key: issue.key, patch: { assigneeId: next }, version: issue.version },
                  { onError: (e) => toast.error(apiErrorMessage(e)) },
                );
              }
            }}
            className={`${INLINE_TRIGGER} justify-end`}
            renderTrigger={() =>
              issue.assignee ? (
                <span className="flex items-center gap-1.5">
                  <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={18} />
                  <span className="truncate">{issue.assignee.displayName}</span>
                </span>
              ) : (
                <span className="text-faint">Chưa gán</span>
              )
            }
          />
        </div>

        <InfoRow label="Người báo cáo">
          {issue.reporter ? (
            <span className="flex items-center justify-end gap-1.5">
              <Avatar name={issue.reporter.displayName} src={issue.reporter.avatarUrl} size={18} />
              <span className="truncate">{issue.reporter.displayName}</span>
            </span>
          ) : '—'}
        </InfoRow>
      </div>
    </PanelSection>
  );
}

/* ------------------------------------------------------------------ */
/* Ngày (cột phải — Hạn / Tạo / Cập nhật / Giải quyết)                */
/* ------------------------------------------------------------------ */

export function IssueDatesPanel({ issue, canEditRestricted }: { issue: IssueDto; canEditRestricted: boolean }) {
  return (
    <PanelSection title="Ngày">
      <div className="divide-y divide-border">
        <DueRow issue={issue} canEdit={canEditRestricted} />
        <InfoRow label="Ngày tạo">
          <span title={relTime(issue.createdAt)}>{fmtDateTime(issue.createdAt)}</span>
        </InfoRow>
        <InfoRow label="Cập nhật">
          <span title={relTime(issue.updatedAt)}>{fmtDateTime(issue.updatedAt)}</span>
        </InfoRow>
        {issue.resolvedAt && (
          <InfoRow label="Đã giải quyết">
            <span title={relTime(issue.resolvedAt)}>{fmtDateTime(issue.resolvedAt)}</span>
          </InfoRow>
        )}
      </div>
    </PanelSection>
  );
}

/** Hàng "Hạn": nhãn ngày, bấm mới sửa (khoá nếu không có quyền). */
function DueRow({ issue, canEdit }: { issue: IssueDto; canEdit: boolean }) {
  const patch = useUpdateIssue(issue.projectId);
  const [editing, setEditing] = useState(false);
  const display = issue.dueDate ? fmtDateTime(issue.dueDate) : null;

  // Màu theo hạn: quá hạn = đỏ đậm nổi bật, sắp đến hạn = vàng, còn lại = bình thường.
  const st = dueState(issue);
  const toneCls =
    st === 'overdue' ? 'bg-danger/10 font-semibold text-danger'
    : st === 'soon' ? 'font-medium text-warning'
    : 'text-ink';

  function save(raw: string) {
    setEditing(false);
    const cur = issue.dueDate ? toLocalInput(issue.dueDate) : '';
    if (raw === cur) return;
    patch.mutate(
      { id: issue.id, key: issue.key, patch: { dueDate: raw ? new Date(raw).toISOString() : null }, version: issue.version },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex shrink-0 items-center gap-1 text-muted">
        Hạn
        {!canEdit && <Lock className="h-3 w-3 text-faint" aria-label="Chỉ người tạo hoặc quản trị được sửa" />}
      </span>
      {editing && canEdit ? (
        <Input
          type="datetime-local"
          autoFocus
          defaultValue={issue.dueDate ? toLocalInput(issue.dueDate) : ''}
          className="h-8 w-52 text-sm"
          disabled={patch.isPending}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn('rounded px-1.5 py-0.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]', display ? toneCls : 'text-faint')}
        >
          {display ?? 'Đặt hạn'}
        </button>
      ) : (
        <span className={cn('rounded px-1.5 py-0.5', display ? toneCls : 'text-ink')}>{display ?? '—'}</span>
      )}
    </div>
  );
}
