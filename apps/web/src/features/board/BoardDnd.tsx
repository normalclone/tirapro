import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent, type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { BoardColumnDto, IssueDto } from '@tirapro/types';
import { CardBody } from './Card';

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Nhấn Space để nhấc việc này lên. Khi đang nhấc, dùng phím mũi tên để chọn cột đích, nhấn Space để thả, nhấn Esc để huỷ. Nhấn Enter để mở chi tiết việc.',
};

/**
 * Giữ `DndContext` + `DragOverlay` và TOÀN BỘ state kéo-thả. `children` do `BoardPage` tạo nên có tham chiếu ổn định:
 * khi bắt đầu/kết thúc kéo chỉ `BoardDnd` vẽ lại, `BoardPage` và cây cột/thẻ (đã `memo`) không bị vẽ lại theo.
 * `onMove(issueId, overId)` được gọi khi thả; `overId` rỗng nghĩa là thả ra ngoài mọi cột.
 */
export function BoardDnd({
  issues, columns, onMove, children,
}: {
  issues: IssueDto[] | undefined;
  columns: BoardColumnDto[];
  onMove: (issueId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const issueById = useMemo(() => new Map((issues ?? []).map((i) => [i.id, i])), [issues]);
  const dragging = draggingId ? issueById.get(draggingId) ?? null : null;

  const announcements = useMemo<Announcements>(() => {
    const keyOf = (id: string | number) => issueById.get(String(id))?.key ?? 'Việc';
    // Droppable id = "laneKey::colId" (có swimlane) hoặc "colId" (phẳng).
    const colNameOf = (overId: string | number) => {
      const colId = String(overId).split('::').pop();
      return columns.find((c) => c.id === colId)?.name ?? 'cột khác';
    };
    return {
      onDragStart: ({ active }) => `Đã nhấc ${keyOf(active.id)}. Dùng phím mũi tên để chọn cột, Space để thả, Esc để huỷ.`,
      onDragOver: ({ active, over }) => (over ? `${keyOf(active.id)} đang ở trên cột “${colNameOf(over.id)}”.` : `${keyOf(active.id)} đang ở ngoài các cột.`),
      onDragEnd: ({ active, over }) => (over ? `Đã thả ${keyOf(active.id)} vào cột “${colNameOf(over.id)}”.` : `Đã thả ${keyOf(active.id)} ra ngoài các cột, giữ nguyên.`),
      onDragCancel: ({ active }) => `Đã huỷ kéo ${keyOf(active.id)}, giữ nguyên vị trí.`,
    };
  }, [issueById, columns]);

  const onDragStart = useCallback((e: DragStartEvent) => setDraggingId(String(e.active.id)), []);
  const onDragEnd = useCallback((e: DragEndEvent) => {
    setDraggingId(null);
    onMove(String(e.active.id), e.over ? String(e.over.id) : '');
  }, [onMove]);
  const onDragCancel = useCallback(() => setDraggingId(null), []);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{dragging ? <CardBody issue={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
