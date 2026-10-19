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
  bulkResultTitle,
  labelsToUndo,
  planBulkResult,
  planRestoreField,
  runUndoPlan,
  type BulkField,
  type BulkValue,
  type UndoPlan,
  type VersionedItem,
} from './bulkEdit';

/** Dựng kế hoạch Hoàn tác từ các việc đã chọn (trước khi ghi) và kết quả `updated`; `null` = không hứa Hoàn tác. */
type UndoBuilder = (targets: IssueDto[], updated: VersionedItem[]) => UndoPlan | null;

const restoreField =
  (field: BulkField, canRestore?: (prev: BulkValue) => boolean): UndoBuilder =>
  (targets, updated) =>
    planRestoreField(field, targets, updated, canRestore);

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
  /** Sau mỗi lần ghi: chỉ giữ chọn các id này (rỗng = bỏ chọn hết); phần chưa xong được giữ để thử lại. */
  retainSelection: (keep: ReadonlySet<string>) => void;
  workflows: Workflow[] | undefined;
  sprints: SprintDto[] | undefined;
}) {
  const { projectId, issues, selected, retainSelection, workflows, sprints } = a;
  const bulkUpdate = useBulkUpdateIssues(projectId, {
    boardId: a.boardId,
    invalidate: a.invalidate,
  });
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function undoAll(plan: UndoPlan) {
    try {
      const { stuck, unsent, firstError } = await runUndoPlan(plan, (items, patch) =>
        bulkUpdate.mutateAsync({ items, patch }),
      );
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
      const { updated } = result;
      const outcome = planBulkResult(result, selected);
      // Xong hết → bỏ chọn; một phần → chỉ bỏ chọn phần đã xong, GIỮ phần chưa xong để thử lại.
      retainSelection(outcome.retain);
      // Hoàn tác chỉ áp cho phần ĐÃ cập nhật (kế hoạch dựng từ `updated`, kèm version mới của máy chủ).
      const plan = outcome.kind === 'none' ? null : (undo?.(targets, updated) ?? null);
      const action = plan ? { label: 'Hoàn tác', onClick: () => void undoAll(plan) } : undefined;
      const title = bulkResultTitle(verb, outcome);
      if (outcome.kind === 'all') {
        toast.success(title, { duration: 6000, action });
      } else {
        toast.warning(title, {
          duration: plan ? 8000 : undefined,
          action,
          description: bulkShortfallHint(
            outcome.conflictCount,
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
