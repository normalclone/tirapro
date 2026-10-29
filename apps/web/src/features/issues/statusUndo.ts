import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import type { Workflow } from '@/features/workflow-settings/api';
import { canRevertTransition } from './nextStatuses';

/** Action của toast "Hoàn tác" (sonner). */
export interface UndoAction {
  label: string;
  onClick: () => void;
}

/**
 * Action "Hoàn tác" sau khi chuyển trạng thái — CHỈ có khi workflow cho phép bước ngược `to → from`
 * (nếu không, bấm sẽ bị 409). `undefined` = toast không có nút. `run` thực hiện việc quay lại.
 */
export function statusUndoAction(
  workflows: Workflow[] | undefined,
  fromStatusId: string,
  toStatusId: string,
  run: () => Promise<unknown>,
): UndoAction | undefined {
  if (!canRevertTransition(workflows, fromStatusId, toStatusId)) return undefined;
  return { label: 'Hoàn tác', onClick: () => void run().catch(() => undefined) };
}

/** Mutation chuyển trạng thái tối thiểu mà `transitionUndoAction` cần (`useTransitionDetail`). */
export interface TransitionRunner {
  mutateAsync: (v: {
    id: string;
    key: string;
    toStatusId: string;
    version: number;
    statusName: string;
  }) => Promise<unknown>;
}

/**
 * Tuỳ chọn toast sau chuyển trạng thái bằng `/transition` (trang chi tiết, phím 1..9, Cmd+K): có "Hoàn tác" (quay về `from`
 * bằng version MỚI của máy chủ `updated.version`; lỗi → toast lỗi) chỉ khi bước ngược hợp lệ; kéo dài hơn khi có nút.
 * Board dùng `statusUndoAction` vì hoàn tác của nó kèm mốc rank.
 */
export function transitionToastOptions(a: {
  workflows: Workflow[] | undefined;
  from: { statusId: string; statusName: string };
  toStatusId: string;
  updated: { id: string; key: string; version: number };
  transition: TransitionRunner;
}): { duration: number; action?: UndoAction } {
  const { workflows, from, toStatusId, updated, transition } = a;
  const action = statusUndoAction(workflows, from.statusId, toStatusId, () =>
    transition
      .mutateAsync({
        id: updated.id,
        key: updated.key,
        toStatusId: from.statusId,
        version: updated.version,
        statusName: from.statusName,
      })
      .catch((e) => {
        toast.error(apiErrorMessage(e));
      }),
  );
  return { duration: action ? 4000 : 2000, action };
}
