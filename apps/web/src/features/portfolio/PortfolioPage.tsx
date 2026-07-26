import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { ProgramEditorModal } from './ProgramEditorModal';
import { ProgramProjectsModal } from './ProgramProjectsModal';
import { RoadmapTimeline } from './RoadmapTimeline';
import {
  usePrograms, useProgramRollup, useDeleteProgram,
  type ProgramDto, type RollupGroup, type RollupProject, type RollupStats,
} from './api';

type Tab = 'programs' | 'roadmap';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

function isOverdue(target: string | null, pct: number): boolean {
  if (!target || pct >= 100) return false;
  const t = new Date(target).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/** Thanh tiến độ 3 đoạn (xong / đang làm / cần làm) — cùng ngôn ngữ với tiến trình task. */
function ProgressBar({ stats, className }: { stats: RollupStats; className?: string }) {
  const title = `Công việc: đã xong ${stats.doneCount}/${stats.issueCount} (${stats.progressPct}%) · đang làm ${stats.inProgressCount} · chưa bắt đầu ${stats.todoCount}`;
  return (
    <div
      className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      title={title}
      role="progressbar"
      aria-valuenow={stats.progressPct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Tiến độ: ${stats.progressPct}%`}
    >
      {stats.doneCount > 0 && <span style={{ flexGrow: stats.doneCount, background: 'var(--status-done)' }} />}
      {stats.inProgressCount > 0 && <span style={{ flexGrow: stats.inProgressCount, background: 'var(--status-progress)' }} />}
      {stats.todoCount > 0 && <span style={{ flexGrow: stats.todoCount, background: 'var(--status-todo)' }} />}
    </div>
  );
}

/** Cụm số liệu dạng chữ (tránh lưới thẻ lặp) — đọc theo hàng, mật độ cao. */
function StatLine({ stats, className }: { stats: RollupStats; className?: string }) {
  return (
    <p className={cn('tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted', className)}>
      <span title="Phần trăm công việc đã xong trên tổng số công việc của các dự án trong nhóm này">
        <span className="font-medium text-ink">{stats.progressPct}%</span> hoàn thành
      </span>
      <span aria-hidden className="text-faint">·</span>
      <span title="Số công việc đã xong / tổng số công việc">{stats.doneCount}/{stats.issueCount} công việc</span>
      {stats.overdueCount > 0 && (
        <>
          <span aria-hidden className="text-faint">·</span>
          <span className="font-medium text-danger" title="Công việc chưa xong mà đã qua hạn hoàn thành">
            {stats.overdueCount} quá hạn
          </span>
        </>
      )}
    </p>
  );
}

function ProjectRow({ project }: { project: RollupProject }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{project.key}</span>
        <span className="truncate text-sm text-ink">{project.name}</span>
        {project.isArchived && (
          <span className="shrink-0 text-[11px] text-faint" title="Dự án đã lưu trữ — không còn hoạt động nhưng vẫn tính vào tiến độ">
            đã lưu trữ
          </span>
        )}
      </div>
      <div className="w-full min-w-[8rem] max-w-[14rem] sm:w-40">
        <ProgressBar stats={project} />
      </div>
      <span className="tabular w-16 shrink-0 text-right text-xs text-muted" title="Số công việc đã xong / tổng số công việc của dự án">
        {project.doneCount}/{project.issueCount}
      </span>
      <span
        className={cn('tabular w-20 shrink-0 text-right text-xs', project.overdueCount > 0 ? 'text-danger' : 'text-faint')}
        title={project.overdueCount > 0 ? 'Số công việc chưa xong mà đã qua hạn hoàn thành' : 'Không có công việc nào quá hạn'}
      >
        {project.overdueCount > 0 ? `${project.overdueCount} quá hạn` : 'đúng hạn'}
      </span>
    </li>
  );
}

function GroupCard({
  group,
  canManage,
  onEdit,
  onAssign,
  onDelete,
}: {
  group: RollupGroup;
  canManage: boolean;
  onEdit: () => void;
  onAssign: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);
  const unassigned = group.id === null;
  const late = isOverdue(group.plannedTargetDate, group.progressPct);
  const listId = `program-projects-${group.id ?? 'none'}`;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />}
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color ?? 'var(--faint)' }} aria-hidden />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-strong">{group.name}</span>
              <span className="shrink-0 text-xs text-faint" title="Số dự án đang thuộc chương trình này">{group.projectCount} dự án</span>
              {late && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-danger"
                  style={{ backgroundColor: 'color-mix(in oklch, var(--danger) 12%, transparent)' }}
                  title="Đã qua ngày mục tiêu mà chương trình chưa hoàn thành 100%"
                >
                  Trễ hạn
                </span>
              )}
            </span>
            {group.description && <span className="mt-0.5 block truncate text-xs text-muted">{group.description}</span>}
            <span className="mt-0.5 block text-xs text-faint">
              {group.ownerName ? `Người phụ trách: ${group.ownerName}` : 'Chưa có người phụ trách'}
              {!unassigned && ` · Hạn mục tiêu: ${fmtDate(group.plannedTargetDate)}`}
            </span>
          </span>
        </button>

        <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5 sm:max-w-xs">
          <ProgressBar stats={group} />
          <StatLine stats={group} />
        </div>

        {canManage && !unassigned && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="Chọn dự án thuộc chương trình này"
              aria-label={`Gán dự án cho chương trình ${group.name}`}
              onClick={onAssign}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Sửa tên, người phụ trách và mốc thời gian"
              aria-label={`Sửa chương trình ${group.name}`}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-danger"
              title="Xoá chương trình — các dự án bên trong vẫn được giữ lại"
              aria-label={`Xoá chương trình ${group.name}`}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div id={listId} className="border-t border-border px-4 py-2 sm:px-5">
          {group.projects.length === 0 ? (
            <p className="py-3 text-sm text-muted">
              {canManage
                ? 'Chương trình này chưa có dự án nào. Bấm “Gán dự án” ở trên để thêm, tiến độ sẽ tự tính từ các dự án đó.'
                : 'Chương trình này chưa có dự án nào.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {group.projects.map((p) => <ProjectRow key={p.id} project={p} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Danh mục dự án — gom nhiều dự án thành chương trình, xem tiến độ tổng hợp
 * và dòng thời gian ở một chỗ.
 */
export function PortfolioPage() {
  const canManage = useAuth((s) => s.can('program:manage'));
  const { data: rollup, isLoading } = useProgramRollup();
  const { data: programs } = usePrograms();
  const remove = useDeleteProgram();

  const [tab, setTab] = useState<Tab>('programs');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramDto | null>(null);
  const [assigning, setAssigning] = useState<ProgramDto | null>(null);

  const programById = useMemo(() => new Map((programs ?? []).map((p) => [p.id, p])), [programs]);
  const groups = rollup?.groups ?? [];
  const totals = rollup?.totals;

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: 'programs', label: 'Chương trình', hint: 'Danh sách chương trình và tiến độ từng dự án bên trong' },
    { id: 'roadmap', label: 'Dòng thời gian', hint: 'Xem chương trình và dự án trải trên trục tháng để thấy chỗ chồng lấn' },
  ];

  function openCreate() { setEditing(null); setEditorOpen(true); }
  function openEdit(id: string | null) {
    if (!id) return;
    const p = programById.get(id);
    if (!p) return;
    setEditing(p);
    setEditorOpen(true);
  }
  function openAssign(id: string | null) {
    if (!id) return;
    setAssigning(programById.get(id) ?? null);
  }
  function handleDelete(group: RollupGroup) {
    if (!group.id) return;
    if (!window.confirm(`Xoá chương trình “${group.name}”? Các dự án bên trong vẫn được giữ nguyên, chỉ tách ra khỏi chương trình.`)) return;
    remove.mutate(group.id, {
      onError: (e) => toast.error(apiErrorMessage(e)),
      onSuccess: () => toast.success('Đã xoá chương trình'),
    });
  }

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Danh mục dự án</h1>
          <p className="mt-1 text-sm text-muted">
            Gom các dự án liên quan vào một chương trình để xem tiến độ chung, việc quá hạn và mốc thời gian
            ở một chỗ, thay vì mở từng dự án.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tạo chương trình</Button>
        )}
      </header>

      {totals && totals.projectCount > 0 && (
        <p className="tabular mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-4 text-sm text-muted">
          <span><span className="font-medium text-ink-strong">{totals.programCount}</span> chương trình</span>
          <span><span className="font-medium text-ink-strong">{totals.projectCount}</span> dự án</span>
          <span title="Số công việc đã xong / tổng số công việc của mọi dự án trong danh mục">
            <span className="font-medium text-ink-strong">{totals.doneCount}/{totals.issueCount}</span> công việc hoàn thành
          </span>
          <span title="Phần trăm công việc đã xong trên toàn danh mục">
            <span className="font-medium text-ink-strong">{totals.progressPct}%</span> tiến độ chung
          </span>
          {totals.overdueCount > 0 && (
            <span className="font-medium text-danger" title="Công việc chưa xong mà đã qua hạn hoàn thành">
              {totals.overdueCount} việc quá hạn
            </span>
          )}
        </p>
      )}

      <div className="mb-5 flex gap-1 border-b border-border" role="tablist" aria-label="Cách xem danh mục dự án">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            title={t.hint}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" />}
          title="Chưa có chương trình nào"
          description={
            canManage
              ? 'Chương trình là một nhóm dự án cùng phục vụ một mục đích. Tạo chương trình đầu tiên rồi gán vài dự án vào để xem tiến độ chung.'
              : 'Chương trình là một nhóm dự án cùng phục vụ một mục đích. Khi quản trị viên tạo chương trình, bạn sẽ thấy ở đây.'
          }
          action={canManage ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tạo chương trình</Button> : undefined}
        />
      ) : tab === 'roadmap' ? (
        <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <RoadmapTimeline groups={groups} />
        </section>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id ?? '__unassigned__'}
              group={g}
              canManage={canManage}
              onEdit={() => openEdit(g.id)}
              onAssign={() => openAssign(g.id)}
              onDelete={() => handleDelete(g)}
            />
          ))}
        </div>
      )}

      <ProgramEditorModal open={editorOpen} program={editing} onClose={() => setEditorOpen(false)} />
      <ProgramProjectsModal open={!!assigning} program={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
