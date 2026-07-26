import { useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useProjects } from '@/features/projects/api';
import { GoalEditorModal } from './GoalEditorModal';
import { AttachIssuesModal } from './AttachIssuesModal';
import {
  useDeleteGoal, useDetachGoalIssues, useGoalPeriods, useGoals, useUpdateKeyResult,
  type GoalDto, type KeyResultDto, type ObjectiveStatus,
} from './api';

const STATUS_META: Record<ObjectiveStatus, { label: string; className: string; hint: string }> = {
  DRAFT: { label: 'Nháp', className: 'bg-surface-2 text-muted', hint: 'Đang soạn, chưa công bố cho cả nhóm' },
  ACTIVE: { label: 'Đang theo đuổi', className: 'bg-primary-subtle text-primary', hint: 'Cả nhóm đang làm để đạt mục tiêu này' },
  CLOSED: { label: 'Đã chốt', className: 'bg-success/10 text-success', hint: 'Kỳ đã kết thúc, kết quả không thay đổi nữa' },
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Mọi trạng thái' },
  { value: 'ACTIVE', label: 'Đang theo đuổi' },
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'CLOSED', label: 'Đã chốt' },
];

/** '2026-Q3' → 'Quý 3 năm 2026' để giải nghĩa mã kỳ trong tooltip. */
function periodHint(period: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(period.trim());
  return m ? `Quý ${m[2]} năm ${m[1]}` : `Kỳ ${period}`;
}

/** Định dạng giá trị KR theo đơn vị (số / phần trăm / tiền). */
function formatValue(value: number, unit: KeyResultDto['unit']): string {
  if (unit === 'PERCENT') return `${Math.round(value * 10) / 10}%`;
  if (unit === 'CURRENCY') return new Intl.NumberFormat('vi-VN').format(value);
  return String(Math.round(value * 100) / 100);
}

function ProgressBar({ value, label, size = 'md' }: { value: number; label: string; size?: 'sm' | 'md' }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface-3', size === 'md' ? 'h-2' : 'h-1.5')}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-300 ease-out-quart"
        style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--success)' : 'var(--primary)' }}
      />
    </div>
  );
}

/** Một kết quả then chốt: thanh tiến độ + ô sửa giá trị hiện tại ngay tại chỗ. */
function KeyResultRow({ goal, kr, canManage }: { goal: GoalDto; kr: KeyResultDto; canManage: boolean }) {
  const updateKr = useUpdateKeyResult();
  const [draft, setDraft] = useState(String(kr.currentValue));

  useEffect(() => { setDraft(String(kr.currentValue)); }, [kr.currentValue]);

  async function commit() {
    const next = Number(draft);
    if (!Number.isFinite(next) || next === kr.currentValue) {
      setDraft(String(kr.currentValue));
      return;
    }
    try {
      await updateKr.mutateAsync({ goalId: goal.id, keyResultId: kr.id, currentValue: next });
    } catch (e) {
      setDraft(String(kr.currentValue));
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 truncate text-sm text-ink" title={kr.name}>{kr.name}</p>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Input
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === 'Escape') { setDraft(String(kr.currentValue)); (e.target as HTMLInputElement).blur(); }
              }}
              className="h-8 w-24 tabular-nums text-sm"
              title="Số đo hiện tại. Sửa rồi nhấn Enter là lưu ngay."
              aria-label={`Giá trị hiện tại của ${kr.name}`}
            />
          ) : (
            <span className="tabular-nums text-sm text-ink" title="Số đo hiện tại">{formatValue(kr.currentValue, kr.unit)}</span>
          )}
          <span className="whitespace-nowrap text-xs text-faint" title="Số cần đạt để coi là hoàn thành">
            / {formatValue(kr.targetValue, kr.unit)}
          </span>
          <span
            className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-muted"
            title="Đã đi được bao nhiêu phần đường từ giá trị bắt đầu tới giá trị cần đạt"
          >
            {kr.progress}%
          </span>
        </div>
      </div>
      <div className="mt-1.5">
        <ProgressBar value={kr.progress} label={`Tiến độ ${kr.name}`} size="sm" />
      </div>
    </li>
  );
}

function GoalCard({
  goal, canManage, onEdit, onAttach,
}: {
  goal: GoalDto;
  canManage: boolean;
  onEdit: (goal: GoalDto) => void;
  onAttach: (goal: GoalDto) => void;
}) {
  const remove = useDeleteGoal();
  const detach = useDetachGoalIssues();
  const status = STATUS_META[goal.status];

  async function handleRemove() {
    if (!window.confirm(`Xoá mục tiêu “${goal.name}”? Toàn bộ kết quả then chốt của mục tiêu này cũng bị xoá và không khôi phục được.`)) return;
    try {
      await remove.mutateAsync(goal.id);
      toast.success('Đã xoá mục tiêu');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function handleDetach(issueId: string, issueKey: string) {
    try {
      await detach.mutateAsync({ goalId: goal.id, issueIds: [issueId] });
      toast.success(`Đã gỡ ${issueKey} khỏi mục tiêu`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <article className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink-strong">{goal.name}</h3>
            <Badge className={status.className}><span title={status.hint}>{status.label}</span></Badge>
            {goal.project && (
              <span className="text-xs text-faint" title="Mục tiêu này chỉ áp dụng cho dự án đó">{goal.project.name}</span>
            )}
          </div>
          {goal.description && <p className="mt-1 text-sm text-muted">{goal.description}</p>}
        </div>

        <div className="flex items-center gap-2">
          {goal.owner ? (
            <span className="flex items-center gap-1.5" title={`Người phụ trách mục tiêu: ${goal.owner.displayName}`}>
              <Avatar name={goal.owner.displayName} src={goal.owner.avatarUrl} size={26} />
              <span className="hidden text-sm text-muted sm:inline">{goal.owner.displayName}</span>
            </span>
          ) : (
            <span className="text-xs text-faint" title="Chưa ai nhận trách nhiệm chính cho mục tiêu này">
              Chưa có người phụ trách
            </span>
          )}
          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(goal)}
                title="Sửa mục tiêu và các kết quả then chốt"
                aria-label={`Sửa mục tiêu ${goal.name}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted hover:text-danger"
                title="Xoá mục tiêu cùng toàn bộ kết quả then chốt"
                aria-label={`Xoá mục tiêu ${goal.name}`}
                loading={remove.isPending}
                onClick={() => void handleRemove()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressBar value={goal.progress} label={`Tiến độ tổng của ${goal.name}`} />
          </div>
          <span
            className="shrink-0 text-sm font-semibold tabular-nums text-ink-strong"
            title="Tiến độ chung của mục tiêu, lấy trung bình tiến độ các kết quả then chốt"
          >
            {goal.progress}%
          </span>
        </div>
        <p className="mt-1.5 text-xs text-faint">
          {goal.keyResults.length > 0
            ? `Tính trung bình từ ${goal.keyResults.length} kết quả then chốt`
            : 'Chưa có kết quả then chốt nào để đo tiến độ'}
          {goal.issueCount > 0 && ` · ${goal.issueDoneCount}/${goal.issueCount} công việc đã xong (${goal.issueProgress}%)`}
        </p>
      </div>

      {goal.keyResults.length > 0 && (
        <ul className="divide-y divide-border border-t border-border px-4 py-2 sm:px-5">
          {goal.keyResults.map((kr) => (
            <KeyResultRow key={kr.id} goal={goal} kr={kr} canManage={canManage} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 sm:px-5">
        {goal.issues.map((issue) => (
          <span
            key={issue.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-2 pr-1 text-xs text-muted"
          >
            <span className="font-mono">{issue.key}</span>
            <span className="max-w-[14rem] truncate">{issue.summary}</span>
            {issue.statusCategory === 'DONE' && <span className="text-success" title="Công việc này đã hoàn thành">xong</span>}
            {canManage && (
              <button
                type="button"
                onClick={() => void handleDetach(issue.id, issue.key)}
                title="Gỡ công việc này khỏi mục tiêu (công việc vẫn còn trong dự án)"
                aria-label={`Gỡ ${issue.key} khỏi mục tiêu`}
                className="rounded-full p-0.5 text-faint transition-colors hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAttach(goal)}
            title="Gắn công việc để thấy phần trăm việc đã xong cho mục tiêu này"
          >
            <Link2 className="h-4 w-4" /> Gắn công việc
          </Button>
        )}
        {!canManage && goal.issues.length === 0 && <span className="text-xs text-faint">Chưa gắn công việc nào</span>}
      </div>
    </article>
  );
}

/** MỤC TIÊU & KẾT QUẢ THEN CHỐT (OKR) — nhóm theo kỳ, mỗi mục tiêu là một khối có tiến độ riêng. */
export function GoalsPage() {
  const can = useAuth((s) => s.can);
  const canManage = can('goal:manage');

  const [period, setPeriod] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<ObjectiveStatus | ''>('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GoalDto | null>(null);
  const [attaching, setAttaching] = useState<GoalDto | null>(null);

  const { data: goals, isLoading } = useGoals({ period, projectId, status });
  const { data: periods } = useGoalPeriods();
  const { data: projects } = useProjects();

  const periodOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả các kỳ' },
      ...(periods ?? []).map((p) => ({ value: p, label: p })),
    ],
    [periods],
  );
  const projectOptions = useMemo(
    () => [
      { value: '', label: 'Mọi dự án' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  /** Nhóm mục tiêu theo kỳ, kỳ mới nhất lên đầu. */
  const groups = useMemo(() => {
    const map = new Map<string, GoalDto[]>();
    for (const g of goals ?? []) {
      const arr = map.get(g.period) ?? [];
      arr.push(g);
      map.set(g.period, arr);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [goals]);

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(goal: GoalDto) {
    setEditing(goal);
    setEditorOpen(true);
  }

  // Modal đang mở giữ tham chiếu cũ sau khi lưu → lấy bản mới nhất từ danh sách.
  const attachTarget = attaching ? (goals ?? []).find((g) => g.id === attaching.id) ?? attaching : null;

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Mục tiêu &amp; kết quả then chốt</h1>
          <p className="mt-1 text-sm text-muted">
            Mỗi kỳ (thường là một quý) đặt vài mục tiêu, mỗi mục tiêu kèm những kết quả then chốt đo được bằng số.
            Tiến độ tính từ số đo hiện tại của các kết quả đó. Cách làm này quốc tế gọi là OKR.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Tạo mục tiêu
          </Button>
        )}
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchSelect
          value={period}
          onChange={setPeriod}
          options={periodOptions}
          ariaLabel="Lọc theo kỳ, ví dụ 2026-Q3 là quý 3 năm 2026"
          placeholder="Tất cả các kỳ"
          searchPlaceholder="Tìm kỳ…"
          className="w-40"
        />
        <SearchSelect
          value={projectId}
          onChange={setProjectId}
          options={projectOptions}
          ariaLabel="Lọc theo dự án"
          placeholder="Mọi dự án"
          searchPlaceholder="Tìm dự án…"
          className="w-52"
        />
        <SearchSelect
          value={status}
          onChange={(v) => setStatus(v as ObjectiveStatus | '')}
          options={STATUS_FILTER_OPTIONS}
          ariaLabel="Lọc theo trạng thái"
          className="w-40"
        />
        {(period || projectId || status) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setPeriod(''); setProjectId(''); setStatus(''); }}
          >
            Xoá bộ lọc
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title="Chưa có mục tiêu nào"
          description={
            canManage
              ? 'Mục tiêu cho biết kỳ này cả nhóm hướng tới điều gì. Tạo mục tiêu đầu tiên, thêm vài kết quả then chốt đo được bằng số rồi gắn công việc để theo dõi.'
              : 'Mục tiêu cho biết kỳ này cả nhóm hướng tới điều gì. Khi nhóm của bạn đặt mục tiêu, chúng sẽ hiện ở đây.'
          }
          action={canManage ? <Button onClick={openCreate}><Plus className="h-4 w-4" /> Tạo mục tiêu</Button> : undefined}
        />
      ) : (
        <div className="space-y-8">
          {groups.map(([groupPeriod, items]) => (
            <section key={groupPeriod}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-ink-strong" title={periodHint(groupPeriod)}>{groupPeriod}</h2>
                <span className="text-sm text-faint">{items.length} mục tiêu</span>
              </div>
              <div className="space-y-4">
                {items.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    canManage={canManage}
                    onEdit={openEdit}
                    onAttach={setAttaching}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <GoalEditorModal
        open={editorOpen}
        goal={editing}
        defaultPeriod={period || undefined}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
      />
      <AttachIssuesModal open={!!attachTarget} goal={attachTarget} onClose={() => setAttaching(null)} />
    </div>
  );
}
