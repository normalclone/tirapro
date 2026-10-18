import { useEffect, useRef, useState } from 'react';
import { withKey } from '@/lib/shortcuts';
import { Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration, parseDuration } from '@tirapro/shared';
import type { IssueDto, WorklogDto } from '@tirapro/types';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DateTimeInput } from '@/components/ui/DateInput';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useUpdateIssue } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { useAddWorklog, useDeleteWorklog, useUpdateWorklog, useWorklogs } from './worklog-api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { fmtDateTime, toDateTimeInput } from '@/lib/dateFormat';
import { TimeProgressBar } from './TimeProgressBar';

const QUICK = ['30m', '1h', '2h', '1d'];

/** "2.5" nghĩa là 2,5 giờ → "2h 30m"; chuỗi có đơn vị giữ nguyên. Dùng cho gợi ý ngay khi gõ. */
function previewOf(text: string): { ok: boolean; label: string } {
  if (!text.trim()) return { ok: false, label: '' };
  const sec = parseDuration(text);
  if (sec === null || sec <= 0)
    return { ok: false, label: 'Chưa đọc được — hãy gõ dạng 2h 30m, 90m hoặc 1d (1d = 8 giờ)' };
  return { ok: true, label: `= ${formatDuration(sec)}` };
}

/**
 * Theo dõi thời gian của một công việc: thanh tiến độ (đã làm / ước lượng gốc / còn lại), form "Ghi thời gian"
 * nhận chuỗi kiểu "2h 30m" và danh sách worklog. Phím tắt `w` (ở trang issue) mở form qua `openRequest`.
 */
export function WorklogPanel({ issue, openRequest }: { issue: IssueDto; openRequest?: number }) {
  const me = useAuth((s) => s.user);
  const can = useCanIn(issue.projectId);
  const canEditThis = useCanEditIssue(issue.projectId)(issue);
  const worklogsQuery = useWorklogs(issue.id);
  const { data } = worklogsQuery;
  const add = useAddWorklog(issue.id, issue.key);
  const update = useUpdateWorklog(issue.id, issue.key);
  const remove = useDeleteWorklog(issue.id, issue.key);
  const patchIssue = useUpdateIssue(issue.projectId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorklogDto | null>(null);
  const [deleting, setDeleting] = useState<WorklogDto | null>(null);
  const [editingEstimate, setEditingEstimate] = useState(false);

  const canLog = can('worklog:create');
  const isAdmin = can('project:admin') || can('workspace:admin');
  const canEstimate = canEditThis;

  // Phím `w` được xử lý ở IssueDetailPage (panel này chỉ mount khi cuộn tới) → nhận yêu cầu mở qua `openRequest`.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openRequest || !canLog) return;
    setEditing(null);
    setFormOpen(true);
    // Sau khi form đã vẽ (panel cao hơn) mới cuộn; `scroll-behavior`/reduced-motion do trình duyệt xử lý.
    const raf = requestAnimationFrame(() =>
      sectionRef.current?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [openRequest, canLog]);

  const spent = data?.totalSec ?? issue.timeSpent ?? 0;
  const original = data?.originalEstimate ?? issue.originalEstimate;
  const remaining = data?.remainingEstimate ?? issue.remainingEstimate;

  function saveEstimate(raw: string) {
    setEditingEstimate(false);
    const text = raw.trim();
    const sec = text === '' ? null : parseDuration(text);
    if (text !== '' && (sec === null || sec <= 0))
      return void toast.error(
        'Ước lượng chưa đúng — hãy nhập dạng 2d 4h, 90m hoặc 1d (1d = 8 giờ)',
      );
    if (sec === original) return;
    // Đổi ước lượng gốc thì ước lượng còn lại tính lại theo tổng đã làm.
    patchIssue.mutate(
      {
        id: issue.id,
        key: issue.key,
        version: issue.version,
        patch: {
          originalEstimate: sec,
          remainingEstimate: sec === null ? null : Math.max(0, sec - spent),
        },
      },
      { onSuccess: () => toast.success('Đã cập nhật ước lượng', { duration: 2000 }) },
    );
  }

  function canModify(w: WorklogDto) {
    return w.author.id === me?.id || isAdmin || !!me?.isSystemAdmin;
  }

  return (
    <section
      ref={sectionRef}
      aria-label="Theo dõi thời gian"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <header className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-sm font-semibold text-ink-strong">Thời gian</h2>
        {canLog && !formOpen && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            title={withKey('Ghi thời gian đã làm', 'issue.worklog')}
          >
            <Plus className="h-4 w-4" /> Ghi thời gian
          </Button>
        )}
      </header>

      <TimeProgressBar
        spent={spent}
        original={original}
        remaining={remaining}
        canEstimate={canEstimate}
      />

      {(editingEstimate || canEstimate || !!original) && (
        <div className="mt-3 text-xs text-muted">
          {editingEstimate ? (
            <Input
              autoFocus
              className="h-7 w-32 text-sm"
              aria-label="Ước lượng gốc"
              placeholder="vd 2d 4h"
              defaultValue={original ? formatDuration(original) : ''}
              onBlur={(e) => saveEstimate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingEstimate(false);
              }}
            />
          ) : canEstimate ? (
            <button
              type="button"
              className="rounded px-1 hover:bg-surface-2 hover:text-ink"
              onClick={() => setEditingEstimate(true)}
              title="Sửa ước lượng gốc"
            >
              {original ? `Ước lượng gốc: ${formatDuration(original)}` : 'Đặt ước lượng gốc'}
            </button>
          ) : original ? (
            <span>Ước lượng gốc: {formatDuration(original)}</span>
          ) : null}
        </div>
      )}

      {formOpen && canLog && (
        <WorklogForm
          key={editing?.id ?? 'new'}
          initial={editing}
          busy={add.isPending || update.isPending}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={(v) => {
            const done = () => {
              setFormOpen(false);
              setEditing(null);
              toast.success(editing ? 'Đã cập nhật nhật ký thời gian' : 'Đã ghi thời gian', {
                duration: 2000,
              });
            };
            if (editing) update.mutate({ id: editing.id, ...v }, { onSuccess: done });
            else add.mutate({ ...v, timeSpent: v.timeSpent ?? '' }, { onSuccess: done });
          }}
        />
      )}

      <div className="mt-4">
        <QueryBoundary
          query={worklogsQuery}
          skeleton={<Skeleton className="h-10 w-full" />}
          empty={(d) => !d.items.length}
          emptyState={
            <EmptyState
              size="compact"
              icon={<Clock />}
              title="Chưa ai ghi thời gian cho việc này"
              description={canLog ? 'Bấm “Ghi thời gian” hoặc phím w.' : undefined}
            />
          }
        >
          {(worklogs) => (
            <ul className="divide-y divide-border">
              {worklogs.items.map((w) => (
                <li
                  key={w.id}
                  className="group flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <Avatar name={w.author.displayName} src={w.author.avatarUrl} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">
                      <span className="font-medium">{w.author.displayName}</span>{' '}
                      <span className="font-semibold tabular-nums text-ink-strong">
                        {formatDuration(w.timeSpentSec)}
                      </span>
                    </p>
                    <p className="text-xs text-faint">{fmtDateTime(w.startedAt)}</p>
                    {w.comment && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">
                        {w.comment}
                      </p>
                    )}
                  </div>
                  {canModify(w) && (
                    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Sửa nhật ký thời gian"
                        aria-label="Sửa nhật ký thời gian"
                        onClick={() => {
                          setEditing(w);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted hover:text-danger"
                        title="Xoá nhật ký thời gian"
                        aria-label="Xoá nhật ký thời gian"
                        onClick={() => setDeleting(w)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Xoá bản ghi thời gian này?"
        description={
          deleting
            ? `${formatDuration(deleting.timeSpentSec)} của ${deleting.author.displayName} sẽ bị xoá và ước lượng còn lại được tính lại.`
            : undefined
        }
        confirmLabel="Xoá"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.success('Đã xoá nhật ký thời gian', { duration: 2000 });
            },
            onError: (e) => toast.error(apiErrorMessage(e)),
          });
        }}
      />
    </section>
  );
}

interface FormValues {
  timeSpent?: string;
  startedAt?: string;
  comment?: string | null;
  adjustRemaining?: 'auto' | 'leave' | { set: string };
}

function WorklogForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: WorklogDto | null;
  busy: boolean;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const [time, setTime] = useState(initial ? formatDuration(initial.timeSpentSec) : '');
  const [startedAt, setStartedAt] = useState(
    toDateTimeInput(initial ? new Date(initial.startedAt) : new Date()),
  );
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [mode, setMode] = useState<'auto' | 'leave' | 'set'>('auto');
  const [setValue, setSetValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const preview = previewOf(time);
  const setPreview = mode === 'set' ? previewOf(setValue) : null;
  const canSave = preview.ok && (mode !== 'set' || !!setPreview?.ok) && !busy;

  function submit() {
    if (!canSave) return;
    onSubmit({
      timeSpent: time.trim(),
      startedAt: new Date(startedAt).toISOString(),
      comment: comment.trim() || null,
      adjustRemaining: mode === 'set' ? { set: setValue.trim() } : mode,
    });
  }

  return (
    <form
      className="mt-4 space-y-3 rounded-md border border-border bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      aria-label={initial ? 'Sửa nhật ký thời gian' : 'Ghi thời gian'}
    >
      <div>
        <label htmlFor="wl-time" className="mb-1 block text-xs font-medium text-muted">
          Thời gian đã làm
        </label>
        <Input
          id="wl-time"
          ref={inputRef}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="2h 30m"
          maxLength={40}
          aria-describedby="wl-time-hint"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setTime(q)}
              className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-ink"
            >
              {q}
            </button>
          ))}
          <span
            id="wl-time-hint"
            className={cn(
              'text-xs',
              preview.ok ? 'text-success' : time.trim() ? 'text-danger' : 'text-faint',
            )}
          >
            {preview.label || 'Gõ 2h 30m, 90m hoặc 1d (1d = 8 giờ)'}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="wl-start" className="mb-1 block text-xs font-medium text-muted">
          Bắt đầu lúc
        </label>
        <DateTimeInput
          id="wl-start"
          ariaLabel="Bắt đầu lúc"
          value={startedAt}
          onChange={setStartedAt}
          defaultTime={toDateTimeInput(new Date()).slice(11)}
        />
      </div>

      <div>
        <label htmlFor="wl-comment" className="mb-1 block text-xs font-medium text-muted">
          Ghi chú (không bắt buộc)
        </label>
        <textarea
          id="wl-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-base text-ink placeholder:text-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          placeholder="Đã làm gì trong khoảng thời gian này?"
        />
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted">Ước lượng còn lại</legend>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {(
            [
              ['auto', 'Tự trừ'],
              ['leave', 'Giữ nguyên'],
              ['set', 'Đặt thành…'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-1.5 text-ink">
              <input
                type="radio"
                name="wl-adjust"
                checked={mode === v}
                onChange={() => setMode(v)}
              />
              {label}
            </label>
          ))}
          {mode === 'set' && (
            <Input
              className="h-8 w-28"
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              placeholder="vd 4h"
              aria-label="Ước lượng còn lại mới"
            />
          )}
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Huỷ
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={!canSave}>
          {initial ? 'Lưu' : 'Ghi thời gian'}
        </Button>
      </div>
    </form>
  );
}
