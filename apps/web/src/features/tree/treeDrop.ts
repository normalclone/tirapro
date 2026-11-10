import type { IssueDto } from '@tirapro/types';
import { isEpicIssue, treeParentId } from '@/lib/issueRefs';
import { descendantIdsWithSelf } from '@/lib/issueTree';

export type TreeDropPlan =
  | { kind: 'ignore' }
  | { kind: 'reject'; reason: string }
  | {
      kind: 'set';
      patch: { parentId?: string | null; epicId?: string | null };
      restore: { parentId: string | null; epicId: string | null };
    };

/**
 * Kết quả khi thả `dragged` lên `target` ở Cây việc (`target = null` là vùng "Đưa ra ngoài").
 * Theo mô hình hai cột: thả việc thường lên Epic → `epicId` (và gỡ `parentId` để cây thấy việc dưới epic); sub-task thả lên
 * việc thường (hoặc lên Epic) → `parentId`; việc thường thả lên việc thường → từ chối (cùng cấp không lồng nhau); đưa ra ngoài → gỡ cả hai. `restore` giữ cả hai cột cho Hoàn tác.
 */
export function planTreeDrop(
  dragged: IssueDto,
  target: IssueDto | null,
  issues: IssueDto[],
): TreeDropPlan {
  const restore = { parentId: dragged.parentId ?? null, epicId: dragged.epicId ?? null };
  if (target === null) {
    return treeParentId(dragged) === null
      ? { kind: 'ignore' }
      : { kind: 'set', patch: { parentId: null, epicId: null }, restore };
  }
  if (isEpicIssue(dragged))
    return {
      kind: 'reject',
      reason: 'Epic là cấp cao nhất — chỉ có thể đưa ra ngoài, không đặt vào việc khác',
    };
  if (descendantIdsWithSelf(issues, dragged.id).has(target.id))
    return { kind: 'reject', reason: 'Không thể đặt một việc vào bên trong chính nhánh của nó' };
  if (target.type.isSubtask)
    return {
      kind: 'reject',
      reason: 'Việc con không chứa việc khác — hãy thả lên việc cha của nó',
    };
  if (treeParentId(dragged) === target.id) return { kind: 'ignore' };
  // TIRA-BUG-22: chỉ việc con mới có `parentId`; việc thường chỉ gắn vào Epic (`epicId`), không lồng vào nhau.
  if (!dragged.type.isSubtask && !isEpicIssue(target))
    return {
      kind: 'reject',
      reason:
        'Không thể lồng hai việc cùng cấp vào nhau — việc thường chỉ gắn vào Epic, còn việc con mới nằm dưới một việc cha',
    };
  const viaEpic = isEpicIssue(target) && !dragged.type.isSubtask;
  return viaEpic
    ? { kind: 'set', patch: { epicId: target.id, parentId: null }, restore }
    : { kind: 'set', patch: { parentId: target.id }, restore };
}
