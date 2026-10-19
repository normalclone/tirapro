import { useState } from 'react';
import { toast } from 'sonner';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { canRevertTransition } from '@/features/issues/nextStatuses';
import { pointsConfirmOptions, pointsEditWarningBulk } from '@/features/issues/pointsWarning';
import type { Workflow } from '@/features/workflow-settings/api';
import {
  bulkShortfallHint,
  rejectionReason,
  useBulkUpdateIssues,
  type BulkIssuePatch,
} from '@/features/backlog/api';
import {
  groupByPrev,
  labelsToUndo,
  prevValueOf,
  type BulkField,
  type BulkValue,
  type VersionedItem,
} from './bulkEdit';

/** Một request Hoàn tác: cùng một `patch` cho một nhóm việc (kèm version mới của máy chủ). */
type UndoPlan = Array<{ items: VersionedItem[]; patch: BulkIssuePatch }>;
/** Dựng kế hoạch Hoàn tác từ các việc đã chọn (trước khi ghi) và kết quả `updated`; `null` = không hứa Hoàn tác. */
type UndoBuilder = (targets: IssueDto[], updated: VersionedItem[]) => UndoPlan | null;

/** Hoàn tác "đặt một giá trị cho cả lô": trả từng việc về giá trị cũ, gom theo giá trị cũ (mỗi giá trị một request). */
function restoreField(field: BulkField, canRestore?: (prev: BulkValue) => boolean): UndoBuilder {
  return (targets, updated) => {
    const prev = new Map(targets.map((i) => [i.id, prevValueOf(i, field)]));
    const groups = groupByPrev(updated, prev);
    if (canRestore && [...groups.keys()].some((v) => !canRestore(v))) return null;
    return [...groups].map(([value, items]) => ({ items, patch: { [field]: value } }));
  };
}

/**
 * Thao tác hàng loạt (Việc chờ, Bảng việc): áp `patch` cho các việc đang chọn tuần tự theo lô ≤ 100 (`runBulkInChunks` trong
 * `useBulkUpdateIssues`), toast tổng kết có "Hoàn tác" khi đảo được. Việc bị người khác sửa trước (conflicts) không làm
 * hỏng cả lô, chỉ được đếm là chưa xong. Hoàn tác dùng version máy chủ trả về trong `updated`.
 */
export function useBulkEdit(a: {
  projectId: string;
  /** Bảng đang thao tác: gửi kèm để máy chủ kiểm WIP khi đổi trạng thái. */
  boardId?: string;
  /** Làm mới thêm cache của nơi gọi sau mỗi lần ghi (vd việc của bảng có bộ lọc). */
  invalidate?: () => void;
  issues: IssueDto[] | undefined;
  selected: ReadonlySet<string>;
  clearSelection: () => void;
  workflows: Workflow[] | undefined;
  sprints: SprintDto[] | undefined;
}) {
  const { projectId, issues, selected, clearSelection, workflows, sprints } = a;
  const bulkUpdate = useBulkUpdateIssues(projectId, {
    boardId: a.boardId,
    invalidate: a.invalidate,
  });
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function undoAll(plan: UndoPlan) {
    try {
      let stuck = 0;
      let unsent = 0;
      let firstError: unknown;
      for (const { items, patch } of plan) {
        const r = await bulkUpdate.mutateAsync({ items, patch });
        stuck += r.conflicts.length;
        unsent += r.unsent;
        firstError ??= r.error;
      }
      if (stuck > 0) {
        toast.warning(`Chưa hoàn tác được ${stuck} việc`, {
          description: bulkShortfallHint(stuck, unsent, rejectionReason(firstError)),
        });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function run(patch: BulkIssuePatch, verb: string, undo: UndoBuilder | null) {
    const targets = (issues ?? []).filter((i) => selected.has(i.id));
    if (targets.length === 0) return;
    setBusy(true);
    try {
      const result = await bulkUpdate.mutateAsync({
        items: targets.map((i) => ({ id: i.id, version: i.version })),
        patch,
      });
      const { updated, conflicts } = result;
      clearSelection();
      if (conflicts.length === 0) {
        const plan = undo?.(targets, updated) ?? null;
        toast.success(`Đã ${verb} ${updated.length} việc.`, {
          duration: 6000,
          action: plan ? { label: 'Hoàn tác', onClick: () => void undoAll(plan) } : undefined,
        });
      } else {
        toast.warning(`Đã ${verb} ${updated.length} việc, còn ${conflicts.length} việc chưa xong`, {
          description: bulkShortfallHint(
            conflicts.length,
            result.unsent,
            rejectionReason(result.error),
          ),
        });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const doField = (field: BulkField, value: BulkValue, verb: string, undo: UndoBuilder | null) =>
    run({ [field]: value }, verb, undo);

  return {
    busy,
    /** Gán người phụ trách (dùng cho "Gán cho tôi" và "Đổi người phụ trách"). */
    assign: (assigneeId: string | null) =>
      doField('assigneeId', assigneeId, 'cập nhật', restoreField('assigneeId')),
    /** Chuyển sprint (sprintId = null → Backlog). */
    moveToSprint: (sprintId: string | null) =>
      doField('sprintId', sprintId, 'chuyển', restoreField('sprintId')),
    /** Đặt điểm (null = xoá). Có việc Done/thuộc sprint đã kết thúc → MỘT hộp xác nhận cho cả lô (B9). */
    async setPoints(points: number | null) {
      const targets = (issues ?? []).filter((i) => selected.has(i.id));
      const w = pointsEditWarningBulk(
        targets.filter((i) => i.storyPoints !== points),
        sprints,
      );
      if (w && !(await confirm(pointsConfirmOptions(w)))) return;
      await doField('storyPoints', points, 'đặt điểm cho', restoreField('storyPoints'));
    },
    setPriority: (priorityId: string | null) =>
      doField('priorityId', priorityId, 'đặt ưu tiên cho', restoreField('priorityId')),
    setEpic: (epicId: string | null) =>
      doField('epicId', epicId, 'gắn epic cho', restoreField('epicId')),
    /** Chỉ THÊM nhãn; Hoàn tác chỉ gỡ khỏi những việc chưa có nhãn đó trước đó. */
    addLabel: (labelId: string) =>
      run({ labels: { add: [labelId] } }, 'gắn nhãn cho', (targets, updated) => {
        const items = labelsToUndo(targets, updated, labelId);
        return items.length ? [{ items, patch: { labels: { remove: [labelId] } } }] : null;
      }),
    /** Đổi trạng thái; Hoàn tác chỉ khi workflow cho phép bước ngược của MỌI nhóm (như `statusUndo`). */
    setStatus: (statusId: string) =>
      doField(
        'statusId',
        statusId,
        'chuyển trạng thái cho',
        restoreField('statusId', (prev) =>
          typeof prev === 'string' ? canRevertTransition(workflows, prev, statusId) : false,
        ),
      ),
  };
}
