import { useState } from 'react';
import { CalendarClock, Play, Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProjects } from '@/features/projects/api';
import {
  useDigests,
  useCreateDigest,
  useUpdateDigest,
  useDeleteDigest,
  useRunDigest,
  type Digest,
  type DigestSchedule,
} from './api';

/* ------------------------------------------------------------------ */
/* Hằng số                                                            */
/* ------------------------------------------------------------------ */

const SCHEDULE_LABEL: Record<DigestSchedule, string> = {
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần',
  SPRINT_END: 'Cuối sprint',
  MANUAL: 'Thủ công',
};

const SCHEDULE_OPTIONS: DigestSchedule[] = ['DAILY', 'WEEKLY', 'SPRINT_END', 'MANUAL'];

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-bg px-3 text-base text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

/** Bỏ thẻ HTML (vd <b>) khỏi summaryText — backend trả về chuỗi dạng HTML-ish. */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/* ------------------------------------------------------------------ */
/* Section                                                            */
/* ------------------------------------------------------------------ */

export function DigestsSection() {
  const { data, isLoading } = useDigests();
  const { data: projectsData } = useProjects();
  const create = useCreateDigest();
  const remove = useDeleteDigest();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState<DigestSchedule>('WEEKLY');
  const [projectId, setProjectId] = useState('');

  const digests = data ?? [];
  const projects = projectsData ?? [];

  function resetAdd() {
    setName('');
    setSchedule('WEEKLY');
    setProjectId('');
    setAdding(false);
  }

  function submitAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Vui lòng nhập tên báo cáo.');
      return;
    }
    create.mutate(
      {
        name: trimmed,
        schedule,
        projectId: projectId === '' ? undefined : projectId,
        // channel/metrics để mặc định ở MVP — sẽ cấu hình kênh gửi sau.
      },
      {
        onSuccess: () => {
          resetAdd();
          toast.success('Đã tạo báo cáo định kỳ.');
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleDelete(digest: Digest) {
    if (!window.confirm(`Xoá báo cáo "${digest.name}"? Hành động này không thể hoàn tác.`)) return;
    remove.mutate(digest.id, {
      onSuccess: () => toast.success('Đã xoá báo cáo.'),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Báo cáo định kỳ (Digest)</h2>
          <p className="mt-0.5 text-sm text-muted">
            Tổng hợp tiến độ dự án theo lịch và gửi qua Telegram nếu có kênh được cấu hình.
          </p>
        </div>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : digests.length === 0 && !adding ? (
          <EmptyState
            icon={<CalendarClock className="h-6 w-6" />}
            title="Chưa có digest nào"
            description="Tạo báo cáo định kỳ để tự động tổng hợp tiến độ dự án theo lịch."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Tạo báo cáo
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {digests.map((digest) => (
              <DigestRow
                key={digest.id}
                digest={digest}
                onDelete={() => handleDelete(digest)}
                deleting={remove.isPending}
              />
            ))}
          </ul>
        )}

        {/* Form tạo báo cáo */}
        {adding ? (
          <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="digest-name" className="mb-1 block text-xs font-medium text-muted">
                  Tên báo cáo
                </label>
                <Input
                  id="digest-name"
                  value={name}
                  autoFocus
                  placeholder="VD: Tổng kết tuần"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd();
                    if (e.key === 'Escape') resetAdd();
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="digest-schedule"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Lịch gửi
                </label>
                <select
                  id="digest-schedule"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value as DigestSchedule)}
                  className={SELECT_CLASS}
                >
                  {SCHEDULE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {SCHEDULE_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="digest-project"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Dự án <span className="text-faint">(tùy chọn)</span>
                </label>
                <SearchSelect
                  id="digest-project"
                  value={projectId}
                  onChange={setProjectId}
                  options={[
                    { value: '', label: 'Tất cả dự án' },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                  className="w-full"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-faint">
              Báo cáo sẽ gửi qua Telegram nếu có kênh được cấu hình.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={submitAdd} loading={create.isPending}>
                Tạo báo cáo
              </Button>
              <Button size="sm" variant="ghost" onClick={resetAdd} disabled={create.isPending}>
                Huỷ
              </Button>
            </div>
          </div>
        ) : (
          digests.length > 0 && (
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Tạo báo cáo
            </Button>
          )
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Hàng digest                                                        */
/* ------------------------------------------------------------------ */

function DigestRow({
  digest,
  onDelete,
  deleting,
}: {
  digest: Digest;
  onDelete: () => void;
  deleting: boolean;
}) {
  const update = useUpdateDigest();
  const run = useRunDigest();

  const [summary, setSummary] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function handleToggle() {
    update.mutate(
      { id: digest.id, isEnabled: !digest.isEnabled },
      {
        onSuccess: () =>
          toast.success(digest.isEnabled ? 'Đã tạm dừng báo cáo.' : 'Đã bật báo cáo.'),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function handleRun() {
    run.mutate(digest.id, {
      onSuccess: (res) => {
        const text = stripTags(res.summaryText ?? '');
        setSummary(text);
        setExpanded(true);
        if (res.sent) {
          toast.success(text ? truncate(text) : 'Đã gửi báo cáo.');
        } else {
          toast.info(
            text ? truncate(text) : 'Đã tạo bản tổng hợp nhưng chưa gửi (chưa có kênh).',
          );
        }
      },
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const lastRunLabel = digest.lastRunAt
    ? formatDistanceToNow(new Date(digest.lastRunAt), { addSuffix: true })
    : 'Chưa chạy lần nào';

  return (
    <li className="rounded-md border border-border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{digest.name}</span>
          <Badge className="bg-surface-2 text-muted">{SCHEDULE_LABEL[digest.schedule]}</Badge>
          {!digest.isEnabled && <Badge className="bg-surface-2 text-faint">Tạm dừng</Badge>}
          <span className="hidden truncate text-xs text-faint sm:inline">{lastRunLabel}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Bật / tắt báo cáo */}
          <button
            type="button"
            role="switch"
            aria-checked={digest.isEnabled}
            aria-label={digest.isEnabled ? 'Tắt báo cáo' : 'Bật báo cáo'}
            onClick={handleToggle}
            disabled={update.isPending}
            title={digest.isEnabled ? 'Đang bật — bấm để tạm dừng' : 'Đang tạm dừng — bấm để bật'}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50',
              digest.isEnabled ? 'bg-primary' : 'bg-surface-3',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150',
                digest.isEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
              )}
            />
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRun}
            loading={run.isPending}
            title="Chạy báo cáo ngay và xem bản tổng hợp"
          >
            <Play className="h-4 w-4" />
            Chạy ngay
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={deleting}
            className="text-muted hover:text-danger"
            title="Xoá báo cáo"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Xoá {digest.name}</span>
          </Button>
        </div>
      </div>

      {/* lastRunAt cho màn hình hẹp */}
      <p className="px-3 pb-2 text-xs text-faint sm:hidden">{lastRunLabel}</p>

      {/* Bản tổng hợp sau khi chạy */}
      {summary !== null && (
        <div className="border-t border-border bg-surface-2 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-faint" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-faint" />
            )}
            Bản tổng hợp
          </button>
          {expanded && (
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-xs text-ink">
              {summary || 'Không có nội dung tổng hợp.'}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
