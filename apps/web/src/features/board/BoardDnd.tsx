import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import { dropContainer } from '@/lib/dropContainer';
import { dropHint } from '@/lib/dropHint';
import { placementFromDnd, type Placement } from '@/lib/rankDrop';
import { sortableCollision } from '@/lib/sortableDnd';
import { CardBody } from './Card';
import { dropFeedback, dropMessage, type DropPlan } from './dropPlan';

const clearFeedback = () => {
  dropHint.set(null);
  dropContainer.set(null);
};

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Nhấn Space để nhấc việc này lên. Khi đang nhấc, dùng mũi tên lên hoặc xuống để đổi thứ tự trong cột, mũi tên trái hoặc phải để sang cột khác, nhấn Space để thả, nhấn Esc để huỷ. Nhấn Enter để mở chi tiết việc.',
};

/**
 * Giữ `DndContext` + `DragOverlay` và TOÀN BỘ state kéo-thả. `children` do `BoardPage` tạo nên có tham chiếu ổn định:
 * khi bắt đầu/kết thúc kéo chỉ `BoardDnd` vẽ lại, `BoardPage` và cây cột/thẻ (đã `memo`) không bị vẽ lại theo.
 * `onMove(issueId, placement)` được gọi khi thả; `placement` null nghĩa là thả ra ngoài mọi cột. Thẻ đổi chỗ live trong
 * CÙNG cột (SortableContext); sang cột khác thì cột đích nổi viền + đường kẻ chèn (`dropHint`) — thẻ chỉ chuyển chỗ khi thả.
 */
export function BoardDnd({
  issues,
  columns,
  onMove,
  planOf,
  children,
}: {
  issues: IssueDto[] | undefined;
  columns: BoardColumnDto[];
  onMove: (issueId: string, placement: Placement | null) => void;
  /** Thả `issue` ở `placement` thì sẽ làm gì (null = đích không dùng được) — để phản hồi lúc kéo khớp kết quả thật. */
  planOf: (issue: IssueDto, placement: Placement) => DropPlan | null;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const issueById = useMemo(() => new Map((issues ?? []).map((i) => [i.id, i])), [issues]);
  const dragging = draggingId ? (issueById.get(draggingId) ?? null) : null;

  const announcements = useMemo<Announcements>(() => {
    const keyOf = (id: string | number) => issueById.get(String(id))?.key ?? 'Việc';
    // containerId = "laneKey::colId" (có swimlane) hoặc "colId" (phẳng).
    const colNameOf = (containerId: string) =>
      columns.find((c) => c.id === containerId.split('::').pop())?.name ?? 'cột khác';
    const say = (phase: 'over' | 'end', e: Pick<DragOverEvent, 'active' | 'over'>) => {
      const p = placementFromDnd(e);
      const issue = issueById.get(String(e.active.id));
      return dropMessage(phase, {
        key: keyOf(e.active.id),
        colName: p ? colNameOf(p.containerId) : '',
        plan: p && issue ? planOf(issue, p) : null,
        p,
      });
    };
    return {
      onDragStart: ({ active }) => {
        const s = active.data.current?.sortable as
          | { containerId: string; index: number; items: unknown[] }
          | undefined;
        const where = s
          ? ` ở cột “${colNameOf(String(s.containerId))}”, vị trí ${s.index + 1}/${s.items.length}`
          : '';
        return `Đã nhấc ${keyOf(active.id)}${where}. Mũi tên lên xuống đổi thứ tự, trái phải sang cột khác, Space để thả, Esc để huỷ.`;
      },
      onDragOver: (e) => say('over', e),
      onDragEnd: (e) => say('end', e),
      onDragCancel: ({ active }) => `Đã huỷ kéo ${keyOf(active.id)}, giữ nguyên vị trí.`,
    };
  }, [issueById, columns, planOf]);

  const onDragStart = useCallback((e: DragStartEvent) => setDraggingId(String(e.active.id)), []);
  // "Nửa trên/nửa dưới" của thẻ mốc đổi mà `over` không đổi → cập nhật hint ở onDragMove, không ở onDragOver.
  // Vạch chèn + viền cột đích theo KẾT QUẢ thả thật (`planOf`): không đổi gì ⇒ không vạch, không viền.
  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const p = placementFromDnd(e);
      const issue = issueById.get(String(e.active.id));
      const fb = dropFeedback(p && issue ? planOf(issue, p) : null, p);
      dropHint.set(fb.hint);
      dropContainer.set(fb.container);
    },
    [issueById, planOf],
  );
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      clearFeedback();
      onMove(String(e.active.id), placementFromDnd(e));
    },
    [onMove],
  );
  const onDragCancel = useCallback(() => {
    setDraggingId(null);
    clearFeedback();
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={sortableCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging ? <CardBody issue={dragging} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
