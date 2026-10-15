import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Play, CheckCircle2, ChevronRight, Inbox, Sparkles, Pencil } from 'lucide-react';
import { useVirtualizer, defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { byPriorityThenStatus } from '@/lib/issueOrder';
import { buildProgressMap, type SubtreeProgress } from '@/lib/issueTree';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDndContext,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import {
  useProjectSprints,
  useCreateSprint,
  useStartSprint,
  useCompleteSprint,
  useMoveToSprint,
  useBulkUpdateIssues,
  type BulkIssuePatch,
  type MoveIncompleteTo,
} from './api';
import { CompleteSprintDialog } from './CompleteSprintDialog';
import { SprintEditDialog } from './SprintEditDialog';
import { useProjectIssues } from '@/features/issues/api';
import { TruncatedBanner } from '@/features/issues/TruncatedBanner';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { QuickAddRow } from '@/components/ui/QuickAddRow';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useCan } from '@/features/projects/permissions';
import { cn } from '@/lib/utils';
import { IssueRow, IssueRowBody } from './IssueRow';
import { BulkActionBar } from './BulkActionBar';
import { SprintAssistantDialog } from '@/features/ai/SprintAssistantDialog';
import { QuickFilterChips } from '@/features/quick-filters/QuickFilterChips';
import { applyQuickFilters, useQuickFilters } from '@/features/quick-filters/useQuickFilters';
import { AssigneeFilter, applyAssigneeFilter } from '@/features/quick-filters/AssigneeFilter';

/** id của droppable backlog (không phải sprint). */
const BACKLOG_ID = 'backlog';

const STATE_BADGE: Record<SprintDto['state'], { label: string; className: string }> = {
  ACTIVE: { label: 'Đang chạy', className: 'bg-primary-subtle text-primary' },
  FUTURE: { label: 'Chưa bắt đầu', className: 'bg-surface-2 text-muted' },
  CLOSED: { label: 'Đã kết thúc', className: 'bg-surface-2 text-faint' },
};

/** Giải nghĩa cho người mới: backlog và sprint là gì (hiện trong tooltip tiêu đề mỗi khu). */
const BACKLOG_TIP = 'Backlog: danh sách việc chờ, chưa xếp vào đợt làm nào.';
const SPRINT_TIP = 'Sprint: đợt làm việc ngắn, thường 1–2 tuần.';

function pointsSum(issues: IssueDto[]): number {
  return issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
}

export function BacklogPage() {
  const { key = '' } = useParams();
  const {
    data: project,
    isLoading: lp,
    isError: pe,
    error: pErr,
    refetch: refetchProject,
  } = useProject(key);
  const projectId = project?.id;

  const sprintsQ = useProjectSprints(projectId);
  const issuesQ = useProjectIssues(projectId);
  const { data: sprints, isLoading: ls } = sprintsQ;
  const { data: issues, isLoading: li } = issuesQ;

  const can = useCan(projectId);
  const canManageSprint = can('sprint:manage');
  const canManageBacklog = can('backlog:manage');
  const canCreate = can('issue:create');
  const canAssign = can('issue:assign');
  const canUseAi = useAuth((s) => s.can('ai:use'));
  const currentUserId = useAuth((s) => s.user?.id);

  const createSprint = useCreateSprint(projectId ?? '');
  const startSprint = useStartSprint(projectId ?? '');
  const completeSprint = useCompleteSprint(projectId ?? '');
  const moveToSprint = useMoveToSprint(projectId ?? '');
  const bulkUpdate = useBulkUpdateIssues(projectId ?? '');
  const assigneeOptions = useAssigneeOptions(projectId);

  // Bộ lọc nhanh (dùng chung với board) — áp client-side trong mỗi section.
  const { active: quickFilters, toggle: toggleQuickFilter } = useQuickFilters();
  const [assignee, setAssignee] = useState('');

  // Bulk select: id các việc đang chọn + cờ đang chạy batch (khóa thao tác).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [dragging, setDragging] = useState<IssueDto | null>(null);
  // Phần tử cuộn của trang (dùng cho danh sách ảo hoá). Giữ bằng state để Section dài nhận được nó sau khi gắn DOM.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  // Sprint đang chờ xác nhận hoàn thành khi còn việc chưa xong.
  const [completing, setCompleting] = useState<{
    id: string;
    name: string;
    notDone: number;
  } | null>(null);
  const [assistantFor, setAssistantFor] = useState<{
    id: string;
    name: string;
    goal: string | null;
  } | null>(null);
  // Sprint đang mở hộp thoại sửa/xoá.
  const [editing, setEditing] = useState<SprintDto | null>(null);

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

  const hasActive = useMemo(() => (sprints ?? []).some((s) => s.state === 'ACTIVE'), [sprints]);

  // Sprint đã đóng (chỉ để xem lại) — mới nhất trước.
  const closedSprints = useMemo(
    () =>
      (sprints ?? []).filter((s) => s.state === 'CLOSED').sort((a, b) => b.sequence - a.sequence),
    [sprints],
  );

  // Công việc sau khi áp bộ lọc nhanh + người phụ trách — chia vào từng khu (số đếm phản ánh tập đã lọc).
  const filteredIssues = useMemo(
    () =>
      applyAssigneeFilter(applyQuickFilters(issues ?? [], quickFilters, currentUserId), assignee),
    [issues, quickFilters, currentUserId, assignee],
  );

  const bySprint = useMemo(() => {
    const map = new Map<string, IssueDto[]>();
    map.set(BACKLOG_ID, []);
    for (const s of visibleSprints) map.set(s.id, []);
    for (const s of closedSprints) map.set(s.id, []);
    for (const issue of filteredIssues) {
      const bucket = issue.sprintId && map.has(issue.sprintId) ? issue.sprintId : BACKLOG_ID;
      // Việc thuộc sprint không nằm trong danh sách → về Backlog (an toàn).
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
    return (sprints ?? []).find((s) => s.id === id)?.name ?? 'sprint khác';
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
    moveToSprint.mutate(
      { id: issue.id, sprintId: targetSprintId, version: issue.version },
      {
        onError: (err) => toast.error(apiErrorMessage(err)),
        onSuccess: (updated) =>
          toast.success(`Đã chuyển ${issue.key} sang ${labelForSprint(targetSprintId)}`, {
            duration: 4000,
            action: {
              label: 'Hoàn tác',
              // Chuyển ngược về sprint cũ, dùng version máy chủ vừa trả về.
              onClick: () =>
                moveToSprint.mutate(
                  { id: issue.id, sprintId: currentSprintId, version: updated.version },
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
          toast.success(`Đã tạo sprint “${name}”. Kéo việc từ Backlog vào để xếp lịch.`);
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

  /**
   * Áp `patch` cho các issue đã chọn bằng MỘT request. `field` là trường bị đổi — giá trị cũ của nó được giữ
   * để "Hoàn tác". Việc bị người khác sửa trước (conflicts) không làm hỏng cả lô, chỉ được đếm là chưa xong.
   * Hoàn tác dùng version máy chủ trả về trong `updated`, gom theo giá trị cũ (mỗi giá trị cũ một request).
   */
  async function runBulk(field: 'assigneeId' | 'sprintId', patch: BulkIssuePatch, verb: string) {
    const targets = (issues ?? []).filter((i) => selected.has(i.id));
    if (targets.length === 0) return;
    const prevValue = new Map(targets.map((i) => [i.id, i[field] ?? null]));
    setBulkBusy(true);
    try {
      const { updated, conflicts } = await bulkUpdate.mutateAsync({
        items: targets.map((i) => ({ id: i.id, version: i.version })),
        patch,
      });
      clearSelection();

      if (conflicts.length === 0) {
        toast.success(`Đã ${verb} ${updated.length} việc.`, {
          duration: 6000,
          action: {
            label: 'Hoàn tác',
            onClick: () => {
              void (async () => {
                const groups = new Map<string | null, Array<{ id: string; version: number }>>();
                for (const u of updated) {
                  const value = prevValue.get(u.id) ?? null;
                  groups.set(value, [
                    ...(groups.get(value) ?? []),
                    { id: u.id, version: u.version },
                  ]);
                }
                try {
                  let stuck = 0;
                  for (const [value, items] of groups) {
                    const r = await bulkUpdate.mutateAsync({ items, patch: { [field]: value } });
                    stuck += r.conflicts.length;
                  }
                  if (stuck > 0) {
                    toast.warning(`Chưa hoàn tác được ${stuck} việc`, {
                      description:
                        'Người khác vừa sửa những việc đó — hãy tải lại trang để xem bản mới nhất rồi thử lại.',
                    });
                  }
                } catch (err) {
                  toast.error(apiErrorMessage(err));
                }
              })();
            },
          },
        });
      } else {
        toast.warning(`Đã ${verb} ${updated.length} việc, còn ${conflicts.length} việc chưa xong`, {
          description:
            'Người khác vừa sửa những việc đó — hãy tải lại trang để xem bản mới nhất rồi thử lại.',
        });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  // Gán người phụ trách (dùng cho "Gán cho tôi" và "Đổi người phụ trách").
  function bulkAssign(assigneeId: string | null) {
    void runBulk('assigneeId', { assigneeId }, 'cập nhật');
  }

  // Chuyển sprint (sprintId = null → Backlog).
  function bulkMoveToSprint(sprintId: string | null) {
    void runBulk('sprintId', { sprintId }, 'chuyển');
  }

  if (pe) {
    return (
      <div className="p-6">
        <QueryError error={pErr} onRetry={() => refetchProject()} />
      </div>
    );
  }

  if (sprintsQ.isError || issuesQ.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={sprintsQ.error ?? issuesQ.error}
          onRetry={() => {
            void sprintsQ.refetch();
            void issuesQ.refetch();
          }}
        />
      </div>
    );
  }

  if (lp || !projectId || ls || li) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
        <DelayedSpinner />
      </div>
    );
  }

  const backlogIssues = bySprint.get(BACKLOG_ID) ?? [];

  // Bắt đầu sprint: BE chưa có endpoint "hủy bắt đầu" nên không thể Hoàn tác an toàn
  // (dùng toast thường; sẽ bổ sung nút Hoàn tác khi có API đảo ngược).
  function handleStartSprint(id: string, name: string) {
    startSprint.mutate(id, {
      onSuccess: () => toast.success(`Đã bắt đầu sprint “${name}”`),
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  // Xác nhận hoàn thành sprint còn việc chưa xong; người dùng chọn việc chưa xong đi đâu.
  function confirmComplete(moveIncompleteTo: MoveIncompleteTo) {
    if (!completing) return;
    const { id, name, notDone } = completing;
    setCompleting(null);
    const where =
      moveIncompleteTo === 'backlog'
        ? 'quay về Backlog'
        : moveIncompleteTo === 'new'
          ? 'đã chuyển sang sprint mới'
          : `đã chuyển sang “${labelForSprint(moveIncompleteTo.sprintId)}”`;
    completeSprint.mutate(
      { sprintId: id, moveIncompleteTo },
      {
        onSuccess: () =>
          toast.success(
            notDone > 0
              ? `Đã kết thúc sprint “${name}”. ${notDone} việc chưa xong ${where}.`
              : `Đã kết thúc sprint “${name}”`,
          ),
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TruncatedBanner projectId={projectId} />
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <QuickFilterChips active={quickFilters} onToggle={toggleQuickFilter} />
        <AssigneeFilter options={assigneeOptions} value={assignee} onChange={setAssignee} />
        {canManageSprint &&
          (creating ? (
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
            >
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
                placeholder="VD: Sprint 1 — tuần 1 và 2"
                className="h-8 w-56"
                aria-label="Tên sprint mới"
                title={SPRINT_TIP}
              />
              <Button
                type="submit"
                size="sm"
                loading={createSprint.isPending}
                disabled={!newName.trim()}
              >
                Tạo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
              >
                Hủy
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              title={`Tạo một đợt làm việc mới. ${SPRINT_TIP}`}
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" />
              Tạo sprint
            </Button>
          ))}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div ref={setScrollEl} className="flex-1 space-y-4 overflow-y-auto p-6">
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
                scrollEl={scrollEl}
                projectKey={key}
                projectId={projectId}
                canCreate={canCreate}
                quickAddSprintId={sprint.state !== 'CLOSED' ? sprint.id : undefined}
                selectable={canAssign || canManageBacklog}
                canDrag={canManageBacklog}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleSection={toggleSelectSection}
                action={
                  canManageSprint ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={`Sửa sprint ${sprint.name}`}
                        title={
                          sprint.state === 'FUTURE'
                            ? 'Sửa tên, mục tiêu, ngày — hoặc xoá sprint'
                            : 'Sửa mục tiêu và ngày kết thúc'
                        }
                        onClick={() => setEditing(sprint)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {sprint.state === 'FUTURE' ? (
                        <>
                          {canUseAi && (
                            <Button
                              size="sm"
                              variant="secondary"
                              title="Gợi ý việc trong Backlog vừa với năng lực của đội"
                              onClick={() =>
                                setAssistantFor({
                                  id: sprint.id,
                                  name: sprint.name,
                                  goal: sprint.goal ?? null,
                                })
                              }
                            >
                              <Sparkles className="h-4 w-4" />
                              Trợ lý lập sprint
                            </Button>
                          )}
                          <Button
                            size="sm"
                            title={`Bắt đầu đợt làm việc này. ${SPRINT_TIP}`}
                            loading={startSprint.isPending && startSprint.variables === sprint.id}
                            onClick={() => handleStartSprint(sprint.id, sprint.name)}
                          >
                            <Play className="h-4 w-4" />
                            Bắt đầu sprint
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          title="Kết thúc đợt làm việc này. Bạn chọn việc chưa xong đi đâu: Backlog, sprint mới hoặc sprint có sẵn."
                          loading={
                            completeSprint.isPending &&
                            completeSprint.variables?.sprintId === sprint.id
                          }
                          onClick={() =>
                            // Còn việc chưa xong → hỏi chuyển đi đâu; xong hết → kết thúc luôn.
                            notDone > 0
                              ? setCompleting({ id: sprint.id, name: sprint.name, notDone })
                              : completeSprint.mutate(
                                  { sprintId: sprint.id },
                                  {
                                    onSuccess: () =>
                                      toast.success(`Đã kết thúc sprint “${sprint.name}”`),
                                    onError: (err) => toast.error(apiErrorMessage(err)),
                                  },
                                )
                          }
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Kết thúc sprint
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
                hint={
                  sprint.state === 'FUTURE'
                    ? hasActive
                      ? 'Đang có một sprint chạy dở — kết thúc sprint đó trước rồi mới bắt đầu sprint này.'
                      : sprint.goal
                    : notDone > 0
                      ? `Còn ${notDone} việc chưa xong. Khi kết thúc sprint, bạn chọn đưa chúng về Backlog hoặc sang sprint khác.`
                      : sprint.goal
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
            scrollEl={scrollEl}
            projectKey={key}
            projectId={projectId}
            canCreate={canCreate}
            quickAddSprintId={null}
            selectable={canAssign || canManageBacklog}
            canDrag={canManageBacklog}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSection={toggleSelectSection}
            emptyTitle="Backlog đang trống"
            emptyDescription="Đây là nơi chứa việc chưa xếp vào sprint nào. Thêm việc ở ô bên dưới, hoặc kéo việc từ sprint về đây."
          />

          {/* Sprint đã kết thúc — xem lại (chỉ đọc) */}
          {closedSprints.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
                title="Các đợt làm việc đã kết thúc — chỉ xem lại, không sửa được."
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', showClosed && 'rotate-90')}
                />
                Sprint đã kết thúc ({closedSprints.length})
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
                        scrollEl={scrollEl}
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
              onAssignToMe={() => {
                if (currentUserId) bulkAssign(currentUserId);
              }}
              onAssignTo={(userId) => bulkAssign(userId)}
              onMoveToSprint={(sprintId) => bulkMoveToSprint(sprintId)}
              onClear={clearSelection}
            />
          )}
        </div>

        <DragOverlay>{dragging ? <IssueRowBody issue={dragging} overlay /> : null}</DragOverlay>
      </DndContext>

      {assistantFor && projectId && (
        <SprintAssistantDialog
          open
          projectId={projectId}
          sprint={assistantFor}
          onClose={() => setAssistantFor(null)}
        />
      )}

      {completing && (
        <CompleteSprintDialog
          open
          name={completing.name}
          notDone={completing.notDone}
          futureSprints={visibleSprints.filter((sp) => sp.state === 'FUTURE')}
          loading={completeSprint.isPending}
          onConfirm={confirmComplete}
          onCancel={() => setCompleting(null)}
        />
      )}
      {editing && projectId && (
        <SprintEditDialog
          open
          sprint={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Danh sách dài hơn ngưỡng này thì chỉ vẽ các dòng đang trong khung nhìn. */
const VIRTUALIZE_AFTER = 50;
const ROW_ESTIMATE = 40;
const ROW_GAP = 6;

/**
 * Danh sách ảo hoá cuộn theo phần tử cuộn của TRANG (không tạo thanh cuộn lồng nhau). Dòng đang kéo và dòng đang
 * giữ focus luôn được giữ trong DOM để kéo-thả và bàn phím không bị ngắt khi cuộn.
 */
function VirtualRows({
  issues,
  scrollEl,
  renderRow,
}: {
  issues: IssueDto[];
  scrollEl: HTMLDivElement | null;
  renderRow: (issue: IssueDto) => ReactNode;
}) {
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  const { active } = useDndContext();
  const activeIndex = active ? issues.findIndex((i) => i.id === active.id) : -1;

  // Khoảng cách từ đỉnh nội dung cuộn tới đầu danh sách (các khu phía trên đổi chiều cao thì đo lại ở lần vẽ sau).
  const measureMargin = useCallback(() => {
    if (!listEl || !scrollEl) return;
    const m = Math.round(
      listEl.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop,
    );
    setMargin((prev) => (prev === m ? prev : m));
  }, [listEl, scrollEl]);
  useLayoutEffect(() => {
    measureMargin();
  });
  useLayoutEffect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver(measureMargin);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl, measureMargin]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const keep = [activeIndex];
      const focused = listEl?.contains(document.activeElement)
        ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-index]')
        : null;
      if (focused) keep.push(Number(focused.dataset.index));
      for (const k of keep) if (k >= 0 && k < range.count && !indexes.includes(k)) indexes.push(k);
      return indexes.sort((a, b) => a - b);
    },
    [activeIndex, listEl],
  );

  const virtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_ESTIMATE,
    gap: ROW_GAP,
    overscan: 10,
    scrollMargin: margin,
    getItemKey: (i) => issues[i]?.id ?? i,
    rangeExtractor,
  });

  return (
    <div
      ref={setListEl}
      role="list"
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const issue = issues[v.index];
        if (!issue) return null;
        return (
          <div
            key={issue.id}
            role="listitem"
            aria-posinset={v.index + 1}
            aria-setsize={issues.length}
            data-index={v.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${v.start - margin}px)`,
            }}
          >
            {renderRow(issue)}
          </div>
        );
      })}
    </div>
  );
}

function Section({
  id,
  title,
  badge,
  points,
  count,
  issues,
  progressMap,
  scrollEl,
  action,
  hint,
  emptyTitle,
  emptyDescription,
  readOnly,
  canDrag = true,
  projectKey,
  projectId,
  canCreate,
  quickAddSprintId,
  selectable,
  selected,
  onToggleSelect,
  onToggleSection,
}: {
  id: string;
  title: string;
  badge: { label: string; className: string } | null;
  points: number;
  count: number;
  issues: IssueDto[];
  progressMap: Map<string, SubtreeProgress>;
  /** Phần tử cuộn của trang — cần để ảo hoá danh sách dài. */
  scrollEl: HTMLDivElement | null;
  action?: React.ReactNode;
  hint?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Sprint đã đóng: chỉ xem, không kéo-thả. */
  readOnly?: boolean;
  /** Có quyền xếp việc giữa backlog/sprint (`backlog:manage`); false thì dòng không kéo được. */
  canDrag?: boolean;
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
  const showQuickAdd =
    !readOnly && canCreate && projectKey && projectId && quickAddSprintId !== undefined;
  const canSelect = !!selectable && !readOnly;
  const ids = issues.map((i) => i.id);
  const selectedInSection = canSelect && selected ? ids.filter((i) => selected.has(i)).length : 0;
  const allSelected = ids.length > 0 && selectedInSection === ids.length;
  const someSelected = selectedInSection > 0 && !allSelected;
  const titleTip = id === BACKLOG_ID ? BACKLOG_TIP : SPRINT_TIP;
  const renderRow = (issue: IssueDto) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      progress={progressMap.get(issue.id)}
      readOnly={readOnly || !canDrag}
      selectable={canSelect}
      checked={selected?.has(issue.id) ?? false}
      onToggleSelect={onToggleSelect}
    />
  );
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
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => onToggleSection?.(ids, e.target.checked)}
            aria-label={`Chọn tất cả việc trong ${title}`}
          />
        )}
        <h2 className="text-sm font-semibold text-ink-strong" title={titleTip}>
          {title}
        </h2>
        {badge && <Badge className={badge.className}>{badge.label}</Badge>}
        <span
          className="tabular text-xs text-muted"
          title={`${count} việc đang hiển thị · tổng ${points} điểm ước lượng (mức độ lớn của việc)`}
        >
          {count} việc · {points} điểm
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>

      {hint && <p className="px-4 pb-2 text-xs text-muted">{hint}</p>}

      <div className="space-y-1.5 border-t border-border px-2 py-2">
        {issues.length > VIRTUALIZE_AFTER ? (
          <VirtualRows issues={issues} scrollEl={scrollEl} renderRow={renderRow} />
        ) : (
          issues.map((issue) => renderRow(issue))
        )}
        {issues.length === 0 &&
          (emptyTitle ? (
            <div className="p-2">
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={emptyTitle}
                description={emptyDescription}
              />
            </div>
          ) : (
            <p className="px-2 py-5 text-center text-xs text-faint">
              {readOnly
                ? 'Sprint này không có việc nào.'
                : 'Chưa có việc nào. Kéo việc từ Backlog vào đây hoặc thêm mới bên dưới.'}
            </p>
          ))}
        {showQuickAdd && (
          <QuickAddRow
            projectKey={projectKey}
            projectId={projectId}
            extra={{ sprintId: quickAddSprintId }}
            placeholder={
              quickAddSprintId === null ? '+ Thêm việc vào Backlog…' : '+ Thêm việc vào sprint này…'
            }
            compact
          />
        )}
      </div>
    </section>
  );
}
