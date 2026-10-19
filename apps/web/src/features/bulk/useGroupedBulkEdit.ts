import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BulkUpdateIssuesResult, IssueDto } from '@tirapro/types';
import { useConfirm } from '@/components/ui/useConfirm';
import { api, apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import { canRevertTransition } from '@/features/issues/nextStatuses';
import { pointsConfirmOptions, pointsEditWarningBulk } from '@/features/issues/pointsWarning';
import { recordIssueChange } from '@/features/issues/menu/issueOverlay';
import { useProjectPermissionContexts } from '@/features/projects/permissions';
import type { Workflow } from '@/features/workflow-settings/api';
import {
  bulkRequestBody,
  bulkShortfallHint,
  rejectionReason,
  runBulkInChunks,
  type BulkIssuePatch,
} from '@/features/backlog/api';
import {
  labelsToUndo,
  planRestoreField,
  type BulkField,
  type BulkValue,
  type UndoPlan,
  type VersionedItem,
} from './bulkEdit';
import {
  aggregateGroupResults,
  applyNotice,
  conflictHint,
  availableBulkActions,
  groupByProject,
  groupPermsFor,
  groupedBulkTitle,
  mapLimit,
  planConflictRefresh,
  planGroupedUndo,
  type BulkActionId,
  type GroupOutcome,
  type GroupedAggregate,
  type GroupedUndoPlan,
  type ProjectGroup,
} from './groupedBulk';

/** Số dự án gọi song song tối đa (mỗi dự án vẫn tuần tự theo lô ≤ 100: OCC + WIP khoá theo lô). */
const GROUP_CONCURRENCY = 2;

type UndoBuilder = (targets: IssueDto[], updated: VersionedItem[]) => UndoPlan | null;
const restoreField =
  (field: BulkField, canRestore?: (prev: BulkValue) => boolean): UndoBuilder =>
  (targets, updated) =>
    planRestoreField(field, targets, updated, canRestore);

/** Ghi bản mới của các việc vào lớp phủ Bộ lọc (dòng đổi tại chỗ, không refetch). */
function recordAll(updated: readonly IssueDto[]) {
  for (const i of updated) recordIssueChange(i);
}

/** Các việc đã cập nhật gom theo dự án (id + version MỚI của máy chủ) — đầu vào của kế hoạch Hoàn tác. */
function versionsByProject(updated: readonly IssueDto[]): Map<string, VersionedItem[]> {
  const m = new Map<string, VersionedItem[]>();
  for (const i of updated)
    m.set(i.projectId, [...(m.get(i.projectId) ?? []), { id: i.id, version: i.version }]);
  return m;
}

/** Số việc tải lại song song khi làm mới các việc vừa bị 409. */
const REFRESH_CONCURRENCY = 4;

/**
 * Sau 409: tải bản HIỆN TẠI của các việc bị người khác sửa (`GET /issues/:key`) và ghi vào lớp phủ — dòng hiện thay đổi của
 * người kia và mang version mới, nên lần thử lại gửi đúng version (kết quả Bộ lọc nằm trong state, không tự làm mới).
 * Việc tải lỗi vẫn được giữ chọn; trả số lượng để gợi ý trung thực.
 */
async function refreshConflicts(
  ids: readonly string[],
  keyById: ReadonlyMap<string, string>,
): Promise<{ refreshed: number; failed: number }> {
  const attempts = await mapLimit(ids, REFRESH_CONCURRENCY, async (id) => {
    const key = keyById.get(id);
    if (!key) return { id, issue: null };
    try {
      return { id, issue: (await api.get<IssueDto>(`/issues/${key}`)).data };
    } catch {
      return { id, issue: null };
    }
  });
  const { fresh, failedIds } = planConflictRefresh(attempts);
  recordAll(fresh);
  return { refreshed: fresh.length, failed: failedIds.length };
}

/**
 * Gợi ý cho phần chưa xong. 409: tải bản mới để lần thử lại gửi đúng version (không thì 409 mãi); lỗi giữa chừng KHÔNG bị
 * gọi là "người khác sửa" (`unsent` + lý do thật).
 */
async function describeUnfinished(
  agg: GroupedAggregate,
  issues: readonly IssueDto[],
): Promise<string | undefined> {
  const keyById = new Map(issues.map((i) => [i.id, i.key]));
  const r = await refreshConflicts(agg.editedConflictIds, keyById);
  return conflictHint({
    refreshed: r.refreshed,
    refreshFailed: r.failed,
    unsent: agg.unsentCount,
    rejection: rejectionReason(agg.firstError),
  });
}

/** Gửi `patch` cho MỘT nhóm (một dự án) theo lô; lỗi ở lô đầu → nhóm lỗi hẳn (chưa ghi gì). */
async function sendGroup(
  projectId: string,
  items: VersionedItem[],
  patch: BulkIssuePatch,
): Promise<GroupOutcome> {
  try {
    const r = await runBulkInChunks(items, (chunk) =>
      api
        .patch<BulkUpdateIssuesResult>('/issues/bulk', bulkRequestBody(projectId, chunk, patch))
        .then((res) => res.data),
    );
    return {
      projectId,
      ok: true,
      updated: r.updated,
      // `runBulkInChunks`: các việc CHƯA gửi (lô sau lỗi) nằm cuối danh sách conflicts, `r.unsent` việc.
      conflictIds: r.conflicts.slice(0, r.conflicts.length - r.unsent).map((c) => c.id),
      unsentIds: r.conflicts.slice(r.conflicts.length - r.unsent).map((c) => c.id),
      error: r.error,
    };
  } catch (error) {
    return { projectId, ok: false, ids: items.map((i) => i.id), error };
  }
}

/**
 * Hàng loạt cho kết quả Bộ lọc (trải nhiều dự án). Nhóm lựa chọn theo dự án, tính quyền + hành động áp được cho từng nhóm
 * (`availableBulkActions`), gọi bulk API MỘT LẦN mỗi dự án (song song tối đa 2), gom kết quả vào một toast. Việc chưa xong
 * (conflict, nhóm lỗi) vẫn được chọn để thử lại; Hoàn tác (kèm version mới của máy chủ) cũng chạy theo từng dự án và chỉ cho
 * phần đã cập nhật. Dòng kết quả đổi qua lớp phủ `issueOverlay` — KHÔNG làm mới `/search` (sẽ về trang 1, mất "Tải thêm").
 */
export function useGroupedBulkEdit(a: {
  /** Kết quả đang hiện (nguồn các việc đã chọn). */
  issues: IssueDto[] | undefined;
  selected: ReadonlySet<string>;
  retainSelection: (keep: ReadonlySet<string>) => void;
  workflows: Workflow[] | undefined;
  projectKeyById: ReadonlyMap<string, string>;
}) {
  const { issues, selected, retainSelection, workflows, projectKeyById } = a;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const userId = useAuth((s) => s.user?.id);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => groupByProject(issues ?? [], selected), [issues, selected]);
  const projectIds = useMemo(() => groups.map((g) => g.projectId), [groups]);
  const permsOf = useProjectPermissionContexts(projectIds);
  const availability = availableBulkActions(
    groups.map((g) => {
      const { ctx, archived } = permsOf(g.projectId);
      return {
        projectId: g.projectId,
        count: g.issues.length,
        perms: groupPermsFor({ ctx, archived, issues: g.issues, userId }),
      };
    }),
  );
  const keyOf = (projectId: string) => projectKeyById.get(projectId) ?? projectId;

  function refresh(touched: Iterable<string>) {
    for (const pid of touched) {
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(pid) });
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(pid) });
    }
    void qc.invalidateQueries({ queryKey: keys.reports.all });
  }

  async function undoGrouped(plan: GroupedUndoPlan) {
    try {
      const byProject = new Map<string, GroupedUndoPlan>();
      for (const s of plan) byProject.set(s.projectId, [...(byProject.get(s.projectId) ?? []), s]);
      const outcomes = await mapLimit([...byProject], GROUP_CONCURRENCY, async ([pid, steps]) => {
        const done: GroupOutcome[] = [];
        for (const s of steps) done.push(await sendGroup(pid, s.items, s.patch));
        return done;
      });
      const flat = outcomes.flat();
      recordAll(flat.flatMap((o) => (o.ok ? o.updated : [])));
      refresh(byProject.keys());
      const agg = aggregateGroupResults(flat, apiErrorMessage);
      const stuck = agg.retainIds.size;
      if (stuck > 0) {
        toast.warning(`Chưa hoàn tác được ${stuck} việc`, {
          description:
            agg.failedProjects.length > 0
              ? agg.failedProjects.map((f) => `${keyOf(f.projectId)} — ${f.reason}`).join('; ')
              : bulkShortfallHint(
                  agg.conflictCount + agg.unsentCount,
                  agg.unsentCount,
                  rejectionReason(agg.firstError),
                ),
        });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function run(
    id: BulkActionId,
    patch: BulkIssuePatch,
    verb: string,
    undo: UndoBuilder | null,
  ) {
    const avail = availability[id];
    const apply = new Set(avail.applyProjectIds);
    const targets: ProjectGroup[] = groups.filter((g) => apply.has(g.projectId));
    if (targets.length === 0) return;
    // Báo TRƯỚC khi chạy nếu một phần việc bị bỏ qua vì thiếu quyền ở dự án của chúng.
    const notice = applyNotice(avail);
    if (notice && !(await confirm({ title: notice, confirmLabel: 'Tiếp tục' }))) return;
    setBusy(true);
    try {
      const outcomes = await mapLimit(targets, GROUP_CONCURRENCY, (g) =>
        sendGroup(
          g.projectId,
          g.issues.map((i) => ({ id: i.id, version: i.version })),
          patch,
        ),
      );
      const agg = aggregateGroupResults(outcomes, apiErrorMessage);
      recordAll(agg.updated);
      refresh(targets.map((g) => g.projectId));
      // Xong thì bỏ chọn; việc chưa xong (conflict, nhóm lỗi) GIỮ chọn để thử lại. Việc bị bỏ qua vì thiếu quyền không phải lỗi.
      retainSelection(agg.retainIds);

      const plan = undo ? planGroupedUndo(targets, versionsByProject(agg.updated), undo) : null;
      const action = plan
        ? { label: 'Hoàn tác', onClick: () => void undoGrouped(plan) }
        : undefined;
      const title = groupedBulkTitle(verb, agg, keyOf, avail.skipCount);
      if (agg.kind === 'all') {
        toast.success(title, { duration: 6000, action });
      } else {
        toast.warning(title, {
          duration: plan ? 8000 : undefined,
          action,
          description: await describeUnfinished(agg, issues ?? []),
        });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const doField = (id: BulkActionId, field: BulkField, value: BulkValue, verb: string) =>
    run(id, { [field]: value }, verb, restoreField(field));

  return {
    busy,
    groups,
    availability,
    assignMe: (meId: string) => doField('assignMe', 'assigneeId', meId, 'cập nhật'),
    assign: (assigneeId: string | null) => doField('assign', 'assigneeId', assigneeId, 'cập nhật'),
    setPriority: (priorityId: string | null) =>
      doField('priority', 'priorityId', priorityId, 'đặt ưu tiên cho'),
    async setPoints(points: number | null) {
      const apply = new Set(availability.points.applyProjectIds);
      const targets = groups.filter((g) => apply.has(g.projectId)).flatMap((g) => g.issues);
      const w = pointsEditWarningBulk(
        targets.filter((i) => i.storyPoints !== points),
        undefined,
      );
      if (w && !(await confirm(pointsConfirmOptions(w)))) return;
      await doField('points', 'storyPoints', points, 'đặt điểm cho');
    },
    addLabel: (labelId: string) =>
      run('label', { labels: { add: [labelId] } }, 'gắn nhãn cho', (targets, updated) => {
        const items = labelsToUndo(targets, updated, labelId);
        return items.length ? [{ items, patch: { labels: { remove: [labelId] } } }] : null;
      }),
    setStatus: (statusId: string) =>
      run(
        'status',
        { statusId },
        'chuyển trạng thái cho',
        restoreField('statusId', (prev) =>
          typeof prev === 'string' ? canRevertTransition(workflows, prev, statusId) : false,
        ),
      ),
  };
}
