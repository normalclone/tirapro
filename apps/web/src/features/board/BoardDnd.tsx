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
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import { dropHint } from '@/lib/dropHint';
import { hintOf, placementFromDnd, type Placement } from '@/lib/rankDrop';
import { sortableCollision } from '@/lib/sortableDnd';
import { CardBody } from './Card';

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
  children,
}: {
  issues: IssueDto[] | undefined;
  columns: BoardColumnDto[];
  onMove: (issueId: string, placement: Placement | null) => void;
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
    const at = (p: Placement) => `vị trí ${p.index + 1}/${p.total}`;
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
      onDragOver: (e) => {
        const p = placementFromDnd(e);
        if (!p) return `${keyOf(e.active.id)} đang ở ngoài các cột.`;
        return p.crossContainer
          ? `${keyOf(e.active.id)} sang cột “${colNameOf(p.containerId)}”, ${at(p)}.`
          : `${keyOf(e.active.id)} ở ${at(p)} trong cột “${colNameOf(p.containerId)}”.`;
      },
      onDragEnd: (e) => {
        const p = placementFromDnd(e);
        if (!p) return `Đã thả ${keyOf(e.active.id)} ra ngoài các cột, giữ nguyên.`;
        if (p.unchanged)
          return `Đã thả ${keyOf(e.active.id)}, giữ nguyên ${at(p)} trong cột “${colNameOf(p.containerId)}”.`;
        return p.crossContainer
          ? `Đã thả ${keyOf(e.active.id)} vào cột “${colNameOf(p.containerId)}”, ${at(p)}.`
          : `Đã thả ${keyOf(e.active.id)} ở ${at(p)} trong cột “${colNameOf(p.containerId)}”.`;
      },
      onDragCancel: ({ active }) => `Đã huỷ kéo ${keyOf(active.id)}, giữ nguyên vị trí.`,
    };
  }, [issueById, columns]);

  const onDragStart = useCallback((e: DragStartEvent) => setDraggingId(String(e.active.id)), []);
  // "Nửa trên/nửa dưới" của thẻ mốc đổi mà `over` không đổi → cập nhật hint ở onDragMove, không ở onDragOver.
  const onDragMove = useCallback(
    (e: DragMoveEvent) => dropHint.set(hintOf(placementFromDnd(e))),
    [],
  );
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingId(null);
      dropHint.set(null);
      onMove(String(e.active.id), placementFromDnd(e));
    },
    [onMove],
  );
  const onDragCancel = useCallback(() => {
    setDraggingId(null);
    dropHint.set(null);
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
