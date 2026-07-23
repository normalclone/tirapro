import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Play, CheckCircle2, ChevronRight, Inbox } from 'lucide-react';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { buildProgressMap, type SubtreeProgress } from '@/lib/issueTree';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import {
  useProjectSprints, useProjectIssues, useCreateSprint,
  useStartSprint, useCompleteSprint, useMoveToSprint,
  backlogIssuesKey, sprintsKey,
} from './api';
import { useUpdateIssue } from '@/features/issues/api';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Avatar, Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { QuickAddRow } from '@/components/ui/QuickAddRow';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { BulkActionBar } from './BulkActionBar';
import { QuickFilterChips } from '@/features/quick-filters/QuickFilterChips';
import { applyQuickFilters, useQuickFilters } from '@/features/quick-filters/useQuickFilters';
import { AssigneeFilter, applyAssigneeFilter } from '@/features/quick-filters/AssigneeFilter';

/** id của droppable backlog (không phải sprint). */
const BACKLOG_ID = 'backlog';

const STATE_BADGE: Record<SprintDto['state'], { label: string; className: string }> = {
  ACTIVE: { label: 'Đang chạy', className: 'bg-primary-subtle text-primary' },
  FUTURE: { label: 'Sắp tới', className: 'bg-surface-2 text-muted' },
  CLOSED: { label: 'Đã đóng', className: 'bg-surface-2 text-faint' },
};

function pointsSum(issues: IssueDto[]): number {
  return issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
}

export function BacklogPage() {
  const { key = '' } = useParams();
  const { data: project, isLoading: lp, isError: pe, error: pErr, refetch: refetchProject } = useProject(key);
  const projectId = project?.id;

  const sprintsQ = useProjectSprints(projectId);
  const issuesQ = useProjectIssues(projectId);
  const { data: sprints, isLoading: ls } = sprintsQ;
  const { data: issues, isLoading: li } = issuesQ;

  const canManageSprint = useAuth((s) => s.can('sprint:manage'));
  const canManageBacklog = useAuth((s) => s.can('backlog:manage'));
  const canCreate = useAuth((s) => s.can('issue:create'));
  const canAssign = useAuth((s) => s.can('issue:assign'));
  const currentUserId = useAuth((s) => s.user?.id);

  const createSprint = useCreateSprint(projectId ?? '');
  const startSprint = useStartSprint(projectId ?? '');
  const completeSprint = useCompleteSprint(projectId ?? '');
  const moveToSprint = useMoveToSprint(projectId ?? '');
  const updateIssue = useUpdateIssue(projectId);
  const assigneeOptions = useAssigneeOptions(projectId);
  const qc = useQueryClient();

  // Bộ lọc nhanh (dùng chung với board) — áp client-side trong mỗi section.
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');

  // Bulk select: id các việc đang chọn + cờ đang chạy batch (khóa thao tác).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [dragging, setDragging] = useState<IssueDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  // Sprint đang chờ xác nhận hoàn thành khi còn việc chưa xong.
  const [completing, setCompleting] = useState<{ id: string; name: string; notDone: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Sprint hiển thị: chỉ FUTURE/ACTIVE, ACTIVE trước rồi theo sequence.
  const visibleSprints = useMemo(() => {
    return (sprints ?? [])
      .filter((s) => s.state === 'ACTIVE' || s.state === 'FUTURE')
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'ACTIVE' ? -1 : 1;
        return a.sequence - b.sequence;
      });
  }, [sprints]);

  const hasActive = useMemo(
    () => (sprints ?? []).some((s) => s.state === 'ACTIVE'),
    [sprints],
  );

  // Sprint đã đóng (chỉ để xem lại) — mới nhất trước.
  const closedSprints = useMemo(
    () => (sprints ?? []).filter((s) => s.state === 'CLOSED').sort((a, b) => b.sequence - a.sequence),
    [sprints],
  );

  // Issue sau khi áp bộ lọc nhanh + người phụ trách — chia vào từng section (đếm phản ánh tập đã lọc).
  const filteredIssues = useMemo(
    () => applyAssigneeFilter(applyQuickFilters(issues ?? [], quickFilters, currentUserId), assignee),
    [issues, quickFilters, currentUserId, assignee],
  );

  const bySprint = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    map.set(BACKLOG_ID, []);
    for (const s of visibleSprints) map.set(s.id, []);
    for (const s of closedSprints) map.set(s.id, []);
    for (const issue of filteredIssues) {
      const bucket = issue.sprintId && map.has(issue.sprintId) ? issue.sprintId : BACKLOG_ID;
      // Issue thuộc sprint không nằm trong danh sách → về backlog (an toàn).
      if (issue.sprintId && !map.has(issue.sprintId)) continue;
      map.get(bucket)!.push(issue);
    }
    for (const list of map.values()) list.sort(byPriorityThenStatus);
    return map;
  }, [visibleSprints, closedSprints, filteredIssues]);

  const progressMap = useMemo(() => buildProgressMap(issues ?? []), [issues]);

  function onDragStart(e: DragStartEvent) {
    setDragging((issues ?? []).find((i) => i.id === e.active.id) ?? null);
  }

  function labelForSprint(id: string | null): string {
    if (id === null) return 'Backlog';
    return (sprints ?? []).find((s) => s.id === id)?.name ?? 'sprint';
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!canManageBacklog) return;
    const issue = (issues ?? []).find((i) => i.id === e.active.id);
    const overId = e.over?.id;
    if (!issue || overId == null) return;
    const targetSprintId = overId === BACKLOG_ID ? null : String(overId);
    const currentSprintId = issue.sprintId ?? null;
    if (currentSprintId === targetSprintId) return;
    const fromVersion = issue.version;
    moveToSprint.mutate(
      { id: issue.id, sprintId: targetSprintId, version: fromVersion },
      {
        onError: (err) => toast.error(apiErrorMessage(err)),
        onSuccess: () =>
          toast.success(`${issue.key} → ${labelForSprint(targetSprintId)}`, {
            duration: 4000,
            action: {
              label: 'Hoàn tác',
              // Chuyển ngược về sprint cũ; version +1 sau lần chuyển thành công.
              onClick: () =>
                moveToSprint.mutate(
                  { id: issue.id, sprintId: currentSprintId, version: fromVersion + 1 },
                  { onError: (err) => toast.error(apiErrorMessage(err)) },
                ),
            },
          }),
      },
    );
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createSprint.mutate(
      { name },
      {
        onSuccess: () => {
          setNewName('');
          setCreating(false);
          toast.success(`Đã tạo sprint “${name}”`);
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  /* -------------------------- Bulk select -------------------------- */

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Chọn/bỏ chọn toàn bộ việc (đã lọc) trong một section.
  const toggleSelectSection = useCallback((ids: string[], selectAll: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selectAll) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Sau batch: làm mới danh sách issue + sprint của project.
  function invalidateBacklog() {
    if (!projectId) return;
    void qc.invalidateQueries({ queryKey: backlogIssuesKey(projectId) });
    void qc.invalidateQueries({ queryKey: sprintsKey(projectId) });
  }

  /**
   * Chạy một mutation cho từng issue đã chọn (Promise.allSettled) rồi báo kết quả.
   * `run` nhận issue hiện tại (đọc version/giá trị cũ từ list). Trả về giá trị cũ để "Hoàn tác".
   * 409/lỗi lẻ không làm hỏng cả batch — đếm thành công/lỗi.
   */
  async function runBulk<T>(
    run: (issue: IssueDto) => Promise<unknown>,
    capture: (issue: IssueDto) => T,
    undo: (prev: T[]) => Promise<void>,
    verb: string,
  ) {
    const targets = (issues ?? []).filter((i) => selected.has(i.id));
    if (targets.length === 0) return;
    const prevValues = targets.map(capture);
    setBulkBusy(true);
    const results = await Promise.allSettled(targets.map(run));
    setBulkBusy(false);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    clearSelection();
    invalidateBacklog();

    if (fail === 0) {
      toast.success(`Đã ${verb} ${ok} việc`, {
        duration: 6000,
        action: {
          label: 'Hoàn tác',
          onClick: () => {
            void (async () => {
              await undo(prevValues);
              invalidateBacklog();
            })();
          },
        },
      });
    } else {
      toast.warning(`${ok} thành công, ${fail} lỗi`, {
        description: fail > 0 ? 'Một số việc có thể đã bị người khác thay đổi. Hãy thử lại.' : undefined,
      });
    }
  }

  // Gán người phụ trách (dùng cho "Gán cho tôi" và "Đổi người phụ trách").
  function bulkAssign(assigneeId: string | null) {
    void runBulk<{ id: string; key: string; assigneeId: string | null; version: number }>(
      (issue) =>
        updateIssue.mutateAsync({ id: issue.id, key: issue.key, patch: { assigneeId }, version: issue.version }),
      (issue) => ({ id: issue.id, key: issue.key, assigneeId: issue.assigneeId, version: issue.version }),
      async (prev) => {
        await Promise.allSettled(
          prev.map((p) =>
            // version +1 sau lần cập nhật thành công trước đó.
            updateIssue.mutateAsync({ id: p.id, key: p.key, patch: { assigneeId: p.assigneeId }, version: p.version + 1 }),
          ),
        );
      },
      'cập nhật',
    );
  }

  // Chuyển sprint (sprintId = null → Backlog).
  function bulkMoveToSprint(sprintId: string | null) {
    void runBulk<{ id: string; sprintId: string | null; version: number }>(
      (issue) => moveToSprint.mutateAsync({ id: issue.id, sprintId, version: issue.version }),
      (issue) => ({ id: issue.id, sprintId: issue.sprintId ?? null, version: issue.version }),
      async (prev) => {
        await Promise.allSettled(
          prev.map((p) => moveToSprint.mutateAsync({ id: p.id, sprintId: p.sprintId, version: p.version + 1 })),
        );
      },
      'chuyển',
    );
  }

  if (pe) {
    return <div className="p-6"><QueryError error={pErr} onRetry={() => refetchProject()} /></div>;
  }

  if (sprintsQ.isError || issuesQ.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={sprintsQ.error ?? issuesQ.error}
          onRetry={() => { void sprintsQ.refetch(); void issuesQ.refetch(); }}
        />
      </div>
    );
  }

  if (lp || !projectId || ls || li) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        <DelayedSpinner />
      </div>
    );
  }

  const backlogIssues = bySprint.get(BACKLOG_ID) ?? [];

  // Bắt đầu sprint: BE chưa có endpoint "hủy bắt đầu" nên không thể Hoàn tác an toàn
  // (dùng toast thường; sẽ bổ sung nút Hoàn tác khi có API đảo ngược).
  function handleStartSprint(id: string, name: string) {
    startSprint.mutate(id, {
      onSuccess: () => toast.success(`Đã bắt đầu “${name}”`),
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  // Xác nhận hoàn thành sprint còn việc chưa xong (việc chưa xong sẽ về Backlog phía BE).
  function confirmComplete() {
    if (!completing) return;
    const { id, name } = completing;
    setCompleting(null);
    completeSprint.mutate(id, {
      onSuccess: () => toast.success(`Đã hoàn thành “${name}”`),
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
        <AssigneeFilter options={assigneeOptions} value={assignee} onChange={setAssignee} />
        {canManageSprint && (
          creating ? (
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            >
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="Tên sprint…"
                className="h-8 w-56"
                aria-label="Tên sprint mới"
              />
              <Button type="submit" size="sm" loading={createSprint.isPending} disabled={!newName.trim()}>
                Tạo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { setCreating(false); setNewName(''); }}
              >
                Hủy
              </Button>
            </form>
          ) : (
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Tạo sprint
            </Button>
          )
        )}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {visibleSprints.map((sprint) => {
            const sprintIssues = bySprint.get(sprint.id) ?? [];
            const notDone = sprintIssues.filter((i) => i.status.category !== 'DONE').length;
            return (
              <Section
                key={sprint.id}
                id={sprint.id}
                title={sprint.name}
                badge={STATE_BADGE[sprint.state]}
                points={pointsSum(sprintIssues)}
                count={sprintIssues.length}
                issues={sprintIssues}
                progressMap={progressMap}
                projectKey={key}
                projectId={projectId}
                canCreate={canCreate}
                quickAddSprintId={sprint.state !== 'CLOSED' ? sprint.id : undefined}
                selectable={canAssign || canManageBacklog}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleSection={toggleSelectSection}
                action={
                  canManageSprint ? (
                    sprint.state === 'FUTURE' ? (
                      <Button
                        size="sm"
                        loading={startSprint.isPending && startSprint.variables === sprint.id}
                        onClick={() => handleStartSprint(sprint.id, sprint.name)}
                      >
                        <Play className="h-4 w-4" />
                        Bắt đầu
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={completeSprint.isPending && completeSprint.variables === sprint.id}
                        onClick={() =>
                          // Còn việc chưa xong → hỏi xác nhận; xong hết → hoàn thành luôn.
                          notDone > 0
                            ? setCompleting({ id: sprint.id, name: sprint.name, notDone })
                            : completeSprint.mutate(sprint.id, {
                                onSuccess: () => toast.success(`Đã hoàn thành “${sprint.name}”`),
                                onError: (err) => toast.error(apiErrorMessage(err)),
                              })
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Hoàn thành
                      </Button>
                    )
                  ) : undefined
                }
                hint={
                  sprint.state === 'FUTURE'
                    ? (hasActive
                      ? 'Đã có sprint đang chạy — hoàn thành sprint đó trước khi bắt đầu sprint này.'
                      : sprint.goal)
                    : (notDone > 0
                      ? `Còn ${notDone} việc chưa hoàn thành — hoàn thành sprint sẽ chuyển các việc này về Backlog.`
                      : sprint.goal)
                }
              />
            );
          })}

          <Section
            id={BACKLOG_ID}
            title="Backlog"
            badge={null}
            points={pointsSum(backlogIssues)}
            count={backlogIssues.length}
            issues={backlogIssues}
            progressMap={progressMap}
            projectKey={key}
            projectId={projectId}
            canCreate={canCreate}
            quickAddSprintId={null}
            selectable={canAssign || canManageBacklog}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSection={toggleSelectSection}
            emptyTitle="Backlog trống"
            emptyDescription="Tạo issue mới hoặc kéo issue từ sprint về đây."
          />

          {/* Sprint đã đóng — xem lại (chỉ đọc) */}
          {closedSprints.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', showClosed && 'rotate-90')} />
                Sprint đã đóng ({closedSprints.length})
              </button>
              {showClosed && (
                <div className="mt-3 space-y-4">
                  {closedSprints.map((sprint) => {
                    const sprintIssues = bySprint.get(sprint.id) ?? [];
                    return (
                      <Section
                        key={sprint.id}
                        id={sprint.id}
                        title={sprint.name}
                        badge={STATE_BADGE.CLOSED}
                        points={pointsSum(sprintIssues)}
                        count={sprintIssues.length}
                        issues={sprintIssues}
                        progressMap={progressMap}
                        readOnly
                        hint={sprint.goal}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selected.size > 0 && (
            <BulkActionBar
              count={selected.size}
              assigneeOptions={assigneeOptions}
              sprints={visibleSprints}
              busy={bulkBusy}
              canAssign={canAssign}
              canManageBacklog={canManageBacklog}
              onAssignToMe={() => { if (currentUserId) bulkAssign(currentUserId); }}
              onAssignTo={(userId) => bulkAssign(userId)}
              onMoveToSprint={(sprintId) => bulkMoveToSprint(sprintId)}
              onClear={clearSelection}
            />
          )}
        </div>

        <DragOverlay>{dragging ? <IssueRow issue={dragging} overlay /> : null}</DragOverlay>
      </DndContext>

      {completing && (
        <CompleteSprintDialog
          name={completing.name}
          notDone={completing.notDone}
          loading={completeSprint.isPending}
          onConfirm={confirmComplete}
          onCancel={() => setCompleting(null)}
        />
      )}
    </div>
  );
}

function Section({
  id, title, badge, points, count, issues, progressMap, action, hint, emptyTitle, emptyDescription, readOnly,
  projectKey, projectId, canCreate, quickAddSprintId,
  selectable, selected, onToggleSelect, onToggleSection,
}: {
  id: string;
  title: string;
  badge: { label: string; className: string } | null;
  points: number;
  count: number;
  issues: IssueDto[];
  progressMap: Map<string, SubtreeProgress>;
  action?: React.ReactNode;
  hint?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Sprint đã đóng: chỉ xem, không kéo-thả. */
  readOnly?: boolean;
  projectKey?: string;
  projectId?: string;
  canCreate?: boolean;
  /** sprintId cho quick-add (null = backlog). undefined = không hiển thị quick-add. */
  quickAddSprintId?: string | null;
  /** Bật checkbox chọn hàng loạt (không áp cho section chỉ đọc). */
  selectable?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSection?: (ids: string[], selectAll: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: readOnly });
  const showQuickAdd = !readOnly && canCreate && projectKey && projectId && quickAddSprintId !== undefined;
  const canSelect = !!selectable && !readOnly;
  const ids = issues.map((i) => i.id);
  const selectedInSection = canSelect && selected ? ids.filter((i) => selected.has(i)).length : 0;
  const allSelected = ids.length > 0 && selectedInSection === ids.length;
  const someSelected = selectedInSection > 0 && !allSelected;
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'rounded-lg border border-border bg-surface transition-colors',
        isOver && 'ring-2 ring-[var(--ring)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {canSelect && ids.length > 0 && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={(e) => onToggleSection?.(ids, e.target.checked)}
            aria-label={`Chọn tất cả việc trong ${title}`}
          />
        )}
        <h2 className="text-sm font-semibold text-ink-strong">{title}</h2>
        {badge && (
          <Badge className={badge.className}>{badge.label}</Badge>
        )}
        <span className="tabular text-xs text-muted">
          {count} issue · Σ {points} điểm
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {hint && <p className="px-4 pb-2 text-xs text-muted">{hint}</p>}

      <div className="space-y-1.5 border-t border-border px-2 py-2">
        {issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            progress={progressMap.get(issue.id)}
            readOnly={readOnly}
            selectable={canSelect}
            checked={selected?.has(issue.id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        ))}
        {issues.length === 0 && (
          emptyTitle ? (
            <div className="p-2">
              <EmptyState icon={<Inbox className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} />
            </div>
          ) : (
            <p className="px-2 py-5 text-center text-xs text-faint">
              {readOnly ? 'Không có issue' : 'Kéo issue vào đây'}
            </p>
          )
        )}
        {showQuickAdd && (
          <QuickAddRow
            projectKey={projectKey}
            projectId={projectId}
            extra={{ sprintId: quickAddSprintId }}
            placeholder={quickAddSprintId === null ? '+ Thêm việc vào backlog…' : '+ Thêm việc vào sprint…'}
            compact
          />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog xác nhận hoàn thành sprint còn việc chưa xong                */
/* ------------------------------------------------------------------ */

function CompleteSprintDialog({
  name, notDone, loading, onConfirm, onCancel,
}: {
  name: string;
  notDone: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="complete-sprint-title">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onCancel} aria-label="Đóng" />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <h2 id="complete-sprint-title" className="text-base font-semibold text-ink-strong">Hoàn thành “{name}”?</h2>
        <p className="mt-2 text-sm text-muted">
          Còn <span className="font-medium text-ink">{notDone}</span> việc chưa xong. Các việc này sẽ được chuyển về <span className="font-medium text-ink">Backlog</span>.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>Hủy</Button>
          <Button size="sm" loading={loading} onClick={onConfirm}>
            <CheckCircle2 className="h-4 w-4" />
            Hoàn thành sprint
          </Button>
        </div>
      </div>
    </div>
  );
}

function IssueRow({
  issue, overlay, progress, readOnly, selectable, checked, onToggleSelect,
}: {
  issue: IssueDto;
  overlay?: boolean;
  progress?: SubtreeProgress;
  readOnly?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const disabled = overlay || readOnly;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: issue.id, disabled });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const warn = dueBorderClass(issue);
  return (
    <div
      ref={disabled ? undefined : setNodeRef}
      style={style}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={cn(
        'flex items-center gap-3 rounded-md border bg-surface px-2.5 py-2 transition-colors',
        readOnly ? 'cursor-default' : 'cursor-grab touch-none active:cursor-grabbing',
        warn || 'border-transparent hover:border-border',
        'hover:bg-surface-2',
        checked && 'border-primary bg-primary-subtle',
        isDragging && 'opacity-40',
        overlay && 'rotate-1 border-border bg-surface shadow-lg',
      )}
    >
      {selectable && !overlay && (
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          checked={checked}
          // Không cho pointer-down/click lan sang draggable của hàng.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect?.(issue.id)}
          aria-label={`Chọn ${issue.key}`}
        />
      )}
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: issue.priority?.color ?? 'var(--faint)' }}
        title={issue.priority?.name ?? 'Không ưu tiên'}
      />
      <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{issue.summary}</span>
      {issue.labels && issue.labels.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 lg:flex">
          {issue.labels.slice(0, 2).map((l) => (
            <span
              key={l.id}
              className="max-w-[7rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
              style={{ backgroundColor: `color-mix(in oklch, ${l.color || 'var(--faint)'} 16%, transparent)`, color: l.color || 'var(--faint)' }}
            >
              {l.name}
            </span>
          ))}
          {issue.labels.length > 2 && <span className="text-[10px] text-faint">+{issue.labels.length - 2}</span>}
        </span>
      )}
      {progress && progress.total > 0 && (
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex" title={`Tiến trình task con: ${progress.pct}%`}>
          <TaskProgress progress={progress} compact className="w-16" />
          <span className="tabular text-[10px] text-faint">{progress.done}/{progress.total}</span>
        </span>
      )}
      <DueBadge issue={issue} warnOnly className="shrink-0" />
      {issue.storyPoints != null && (
        <span className="tabular grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted">
          {issue.storyPoints}
        </span>
      )}
      {issue.assignee ? (
        <span className="flex shrink-0 items-center gap-1.5" title={`Người làm: ${issue.assignee.displayName}`}>
          <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={20} />
          <span className="hidden max-w-[9rem] truncate text-xs text-muted md:inline">{issue.assignee.displayName}</span>
        </span>
      ) : (
        <span className="hidden shrink-0 text-[11px] text-faint sm:inline">Chưa gán</span>
      )}
    </div>
  );
}
