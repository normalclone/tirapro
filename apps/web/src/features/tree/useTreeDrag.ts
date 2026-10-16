import { useMemo, useState } from 'react';
import {
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useUpdateIssue } from '@/features/issues/api';
import { useCanEditIssue } from '@/features/projects/permissions';
import { apiErrorMessage } from '@/lib/api';
import { planTreeDrop } from './treeDrop';

export const ROOT_DROP_ID = 'tree:root';
export const rowDropId = (id: string) => `tree:${id}`;
const issueIdOfDrop = (id: string) => id.slice('tree:'.length);

export type DropState = 'ok' | 'bad' | null;

/**
 * Kéo thả đổi Epic / Việc cha ở Cây việc: trạng thái kéo, viền đích (tính bằng chính `planTreeDrop`), ghi qua
 * `useUpdateIssue` (OCC + lạc quan) và Hoàn tác. `onDropped(targetId)` để trang mở nhánh đích sau khi thả.
 */
export function useTreeDrag(
  projectId: string | undefined,
  issues: IssueDto[] | undefined,
  onDropped: (targetId: string) => void,
) {
  const canEditIssue = useCanEditIssue(projectId);
  const patchIssue = useUpdateIssue(projectId);
  const all = useMemo(() => issues ?? [], [issues]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  const canEditAny = useMemo(() => all.some((i) => canEditIssue(i)), [all, canEditIssue]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Cần rê 6px mới tính là kéo — bấm trơn vẫn mở công việc.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragged = dragId ? (byId.get(dragId) ?? null) : null;

  /** Trạng thái viền của dòng đang rê: sáng (hợp lệ) / đỏ (bị chặn). */
  function dropStateOf(rowId: string): DropState {
    if (!dragged || overId !== rowDropId(rowId) || rowId === dragged.id) return null;
    const target = byId.get(rowId);
    if (!target) return null;
    const plan = planTreeDrop(dragged, target, all);
    return plan.kind === 'set' ? 'ok' : plan.kind === 'reject' ? 'bad' : null;
  }

  function clear() {
    setDragId(null);
    setOverId(null);
  }

  function commit(issue: IssueDto, target: IssueDto | null) {
    if (!canEditIssue(issue)) {
      toast.info('Bạn không có quyền sửa công việc này.');
      return;
    }
    const plan = planTreeDrop(issue, target, all);
    if (plan.kind === 'ignore') return;
    if (plan.kind === 'reject') {
      toast.info(plan.reason);
      return;
    }
    patchIssue.mutate(
      { id: issue.id, key: issue.key, patch: plan.patch, version: issue.version },
      {
        onSuccess: (res) => {
          if (target) onDropped(target.id);
          const text = !target
            ? `Đã đưa ${issue.key} ra ngoài Epic/việc cha`
            : plan.patch.epicId
              ? `Đã gắn ${issue.key} vào epic ${target.key}`
              : `Đã đặt ${issue.key} làm việc con của ${target.key}`;
          toast.success(text, {
            duration: 5000,
            action: {
              label: 'Hoàn tác',
              onClick: () =>
                patchIssue.mutate(
                  { id: issue.id, key: issue.key, patch: plan.restore, version: res.data.version },
                  { onError: (err) => toast.error(apiErrorMessage(err)) },
                ),
            },
          });
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  function onDragEnd(e: DragEndEvent) {
    clear();
    const issue = byId.get(String(e.active.id));
    const over = e.over ? String(e.over.id) : null;
    if (!issue || over === null || over === rowDropId(issue.id)) return; // thả ra ngoài / lên chính nó = huỷ
    if (over === ROOT_DROP_ID) return commit(issue, null);
    const target = byId.get(issueIdOfDrop(over));
    if (target) commit(issue, target);
  }

  const announcements = useMemo<Announcements>(() => {
    const keyOf = (id: string | number) => byId.get(String(id))?.key ?? 'Việc';
    const overText = (id: string | number | undefined) =>
      id === undefined
        ? 'ngoài cây'
        : String(id) === ROOT_DROP_ID
          ? 'vùng đưa ra ngoài'
          : keyOf(issueIdOfDrop(String(id)));
    return {
      onDragStart: ({ active }) => `Đã nhấc ${keyOf(active.id)}.`,
      onDragOver: ({ active, over }) => `${keyOf(active.id)} đang ở trên ${overText(over?.id)}.`,
      onDragEnd: ({ active, over }) => `Đã thả ${keyOf(active.id)} lên ${overText(over?.id)}.`,
      onDragCancel: ({ active }) => `Đã huỷ kéo ${keyOf(active.id)}, giữ nguyên.`,
    };
  }, [byId]);

  return {
    canEditIssue,
    canEditAny,
    dragged,
    dragId,
    overId,
    dropStateOf,
    dndProps: {
      sensors,
      collisionDetection: pointerWithin,
      accessibility: { announcements },
      onDragStart: (e: DragStartEvent) => setDragId(String(e.active.id)),
      onDragOver: (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null),
      onDragEnd,
      onDragCancel: clear,
    },
  };
}
