import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Check, Flag, Link2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import {
  DEPENDENCY_TYPES,
  DEPENDENCY_TYPE_HINTS,
  DEPENDENCY_TYPE_LABELS,
  useCreateDependency,
  useCreateMilestone,
  useDeleteDependency,
  useDeleteMilestone,
  useDependencies,
  useMilestones,
  useUpdateMilestone,
  type DependencyType,
  type MilestoneDto,
} from './api';

const MILESTONE_COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#16a34a', '#f59e0b', '#dc2626'];
/** Tên màu đọc được, dùng cho nhãn trợ năng thay vì mã hex. */
const MILESTONE_COLOR_NAMES = ['Tím', 'Xanh dương', 'Xanh ngọc', 'Xanh lá', 'Cam', 'Đỏ'];

/** 'YYYY-MM-DD' (input date) → ISO UTC nửa đêm, để BE lưu đúng ngày lịch. */
function dateInputToIso(v: string): string {
  return new Date(`${v}T00:00:00.000Z`).toISOString();
}

function Section({ title, icon, count, children }: {
  title: string; icon: React.ReactNode; count: number; children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <h3 className="flex items-center gap-2 px-5 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-faint">
        <span className="text-muted" aria-hidden>{icon}</span>
        {title}
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-muted">{count}</span>
      </h3>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function DependencySection({ projectId, issues, canManage }: {
  projectId: string; issues: IssueDto[]; canManage: boolean;
}) {
  const { data: deps, isLoading } = useDependencies(projectId);
  const create = useCreateDependency(projectId);
  const remove = useDeleteDependency(projectId);

  const [predecessorId, setPredecessorId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [type, setType] = useState<DependencyType>('FS');
  const [lag, setLag] = useState('0');

  const issueOptions = useMemo(
    () => issues.map((i) => ({ value: i.id, label: i.summary, hint: i.key })),
    [issues],
  );

  async function add() {
    if (!predecessorId || !successorId) return;
    try {
      await create.mutateAsync({
        predecessorId,
        successorId,
        type,
        lagDays: Number.parseInt(lag, 10) || 0,
      });
      toast.success('Đã thêm phụ thuộc');
      setPredecessorId('');
      setSuccessorId('');
      setLag('0');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function del(id: string, label: string) {
    remove.mutate(id, {
      onSuccess: () => toast.success(`Đã xoá phụ thuộc ${label}`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  const sameIssue = !!predecessorId && predecessorId === successorId;
  const canAdd = !!predecessorId && !!successorId && !sameIssue && !create.isPending;

  return (
    <Section title="Phụ thuộc giữa các việc" icon={<Link2 className="h-4 w-4" />} count={deps?.length ?? 0}>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : !deps || deps.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted"
          title="Đường găng là chuỗi việc quyết định ngày kết thúc dự án — trễ một việc trong chuỗi là trễ cả dự án."
        >
          Chưa khai báo phụ thuộc nào. Nối hai việc để hệ thống biết việc nào phải xong trước, và tính được đường găng.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {deps.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink" title={`${d.predecessor.summary} → ${d.successor.summary}`}>
                  <span className="font-mono text-xs text-muted">{d.predecessor.key}</span>
                  <span className="mx-1.5 text-faint" aria-hidden>&rarr;</span>
                  <span className="font-mono text-xs text-muted">{d.successor.key}</span>
                </p>
                <p className="truncate text-xs text-faint" title={DEPENDENCY_TYPE_HINTS[d.type]}>
                  {DEPENDENCY_TYPE_LABELS[d.type]}
                  {d.lagDays > 0 && ` · chờ thêm ${d.lagDays} ngày`}
                  {d.lagDays < 0 && ` · được làm chồng ${-d.lagDays} ngày`}
                </p>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted hover:text-danger"
                  title="Xoá phụ thuộc"
                  aria-label={`Xoá phụ thuộc ${d.predecessor.key} tới ${d.successor.key}`}
                  onClick={() => del(d.id, `${d.predecessor.key} → ${d.successor.key}`)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="dep-pred" title="Việc phải làm xong (hoặc bắt đầu) trước.">
              Việc làm trước
            </label>
            <SearchSelect
              id="dep-pred"
              value={predecessorId}
              onChange={setPredecessorId}
              options={issueOptions}
              placeholder="Chọn công việc…"
              searchPlaceholder="Tìm theo tên hoặc mã…"
              ariaLabel="Việc làm trước"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="dep-succ" title="Việc phải chờ việc ở trên.">
              Việc làm sau
            </label>
            <SearchSelect
              id="dep-succ"
              value={successorId}
              onChange={setSuccessorId}
              options={issueOptions}
              placeholder="Chọn công việc…"
              searchPlaceholder="Tìm theo tên hoặc mã…"
              ariaLabel="Việc làm sau"
            />
          </div>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="dep-type" title={DEPENDENCY_TYPE_HINTS[type]}>
                Kiểu ràng buộc
              </label>
              <SearchSelect
                id="dep-type"
                value={type}
                onChange={(v) => setType(v as DependencyType)}
                options={DEPENDENCY_TYPES.map((t) => ({ value: t, label: DEPENDENCY_TYPE_LABELS[t], hint: t }))}
                ariaLabel="Kiểu ràng buộc giữa hai việc"
              />
            </div>
            <div className="w-24 shrink-0">
              <label
                className="mb-1 block text-xs font-medium text-muted"
                htmlFor="dep-lag"
                title="Số ngày chờ thêm sau khi ràng buộc đã thoả. Nhập số âm nếu hai việc được làm chồng lên nhau."
              >
                Chờ (ngày)
              </label>
              <Input
                id="dep-lag"
                type="number"
                value={lag}
                onChange={(e) => setLag(e.target.value)}
                title="Số ngày chờ thêm sau khi ràng buộc đã thoả. Nhập số âm nếu hai việc được làm chồng lên nhau."
                className="text-sm"
              />
            </div>
          </div>
          {sameIssue && <p className="text-xs text-danger">Một công việc không thể phụ thuộc vào chính nó — hãy chọn hai việc khác nhau.</p>}
          <Button size="sm" className="w-full" onClick={() => void add()} loading={create.isPending} disabled={!canAdd}>
            <Plus className="h-4 w-4" /> Thêm phụ thuộc
          </Button>
        </div>
      )}
    </Section>
  );
}

function MilestoneSection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data: milestones, isLoading } = useMilestones(projectId);
  const create = useCreateMilestone(projectId);
  const update = useUpdateMilestone(projectId);
  const remove = useDeleteMilestone(projectId);

  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [color, setColor] = useState(MILESTONE_COLORS[0]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || !dueDate) return;
    try {
      await create.mutateAsync({ name: trimmed, dueDate: dateInputToIso(dueDate), color });
      toast.success('Đã thêm cột mốc');
      setName('');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function toggleDone(m: MilestoneDto) {
    update.mutate(
      { id: m.id, completedAt: m.completedAt ? null : new Date().toISOString() },
      {
        onSuccess: () => toast.success(m.completedAt ? 'Đã bỏ đánh dấu đã đạt' : 'Đã đánh dấu cột mốc đã đạt'),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  function del(m: MilestoneDto) {
    remove.mutate(m.id, {
      onSuccess: () => toast.success(`Đã xoá cột mốc “${m.name}”`),
      onError: (e) => toast.error(apiErrorMessage(e)),
    });
  }

  return (
    <Section title="Cột mốc" icon={<Flag className="h-4 w-4" />} count={milestones?.length ?? 0}>
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : !milestones || milestones.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted">
          Chưa có cột mốc nào. Cột mốc là ngày quan trọng phải chốt — bàn giao, nghiệm thu; thêm vào để nó hiện thành hình thoi trên biểu đồ lịch trình.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rotate-45"
                style={{ background: m.color ?? 'var(--primary)' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm text-ink', m.completedAt && 'line-through text-muted')}>{m.name}</p>
                <p className="text-xs text-faint" title={m.completedAt ? 'Cột mốc này đã đạt.' : 'Ngày phải đạt cột mốc này.'}>
                  {format(new Date(m.dueDate), 'dd/MM/yyyy')}
                  {m.completedAt && ' · Đã đạt'}
                </p>
              </div>
              {canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn('shrink-0 text-muted hover:text-success', m.completedAt && 'text-success')}
                    title={m.completedAt ? 'Bỏ đánh dấu đã đạt' : 'Đánh dấu cột mốc đã đạt'}
                    aria-label={`${m.completedAt ? 'Bỏ đánh dấu đã đạt' : 'Đánh dấu đã đạt'} cột mốc ${m.name}`}
                    aria-pressed={!!m.completedAt}
                    onClick={() => toggleDone(m)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted hover:text-danger"
                    title="Xoá cột mốc"
                    aria-label={`Xoá cột mốc ${m.name}`}
                    onClick={() => del(m)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="ms-name">Tên cột mốc</label>
            <Input
              id="ms-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
              placeholder="Ví dụ: Bàn giao bản beta"
              maxLength={120}
              className="text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="ms-date">Ngày phải đạt</label>
              <Input id="ms-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="text-sm" />
            </div>
            <div className="flex shrink-0 gap-1.5 pb-1.5">
              {MILESTONE_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={`Màu ${MILESTONE_COLOR_NAMES[i]} cho hình thoi cột mốc trên biểu đồ`}
                  aria-label={`Màu ${MILESTONE_COLOR_NAMES[i]}`}
                  aria-pressed={color === c}
                  className={cn(
                    'h-5 w-5 rotate-45 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    color === c ? 'ring-2 ring-ink-strong ring-offset-2 ring-offset-surface-2' : 'hover:scale-110',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() => void add()}
            loading={create.isPending}
            disabled={!name.trim() || !dueDate || create.isPending}
          >
            <Plus className="h-4 w-4" /> Thêm cột mốc
          </Button>
        </div>
      )}
    </Section>
  );
}

/**
 * Ngăn kéo quản lý lịch trình: phụ thuộc giữa các việc + cột mốc.
 * Chỉ hiện form thêm/xoá khi người dùng có quyền `plan:manage`.
 */
export function PlanningPanel({ open, projectId, issues, canManage, onClose }: {
  open: boolean;
  projectId: string;
  issues: IssueDto[];
  canManage: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng bảng lịch trình"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Phụ thuộc và cột mốc"
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lg animate-in slide-in-from-right duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink-strong">Phụ thuộc &amp; cột mốc</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DependencySection projectId={projectId} issues={issues} canManage={canManage} />
          <MilestoneSection projectId={projectId} canManage={canManage} />
        </div>
      </aside>
    </div>
  );
}
