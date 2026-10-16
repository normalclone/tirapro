import { useMemo, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { GripVertical, Settings2, Trash2 } from 'lucide-react';
import { SORT_TRANSITION } from '@/lib/sortableDnd';
import { cn } from '@/lib/utils';
import type { DraftWidget } from './layoutOps';
import { widgetDefOf } from './registry';
import { WidgetBoundary, WidgetFrame } from './WidgetFrame';
import {
  DASHBOARD_GRID_CLASS,
  WIDTH_LABEL,
  widgetSpanClass,
  type WidgetWidth,
} from './widgetLayout';

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Để nhấc một ô, nhấn Space hoặc Enter. Khi đang nhấc, dùng phím mũi tên để di chuyển, Space hoặc Enter để thả, Esc để huỷ.',
};

/**
 * Lưới ô có thể kéo thả (dnd-kit sortable, `rectSortingStrategy`): chuột (kéo 6px mới nhấc để không chặn bấm), cảm ứng
 * (giữ 200ms để vuốt dọc vẫn cuộn trang) và bàn phím (`sortableKeyboardCoordinates`) kèm thông báo tiếng Việt.
 */
export function SortableGrid({
  widgets,
  issues,
  onMove,
  onDraggingChange,
  onResize,
  onConfig,
  onRemove,
}: {
  /** Đã sắp theo `order`. */
  widgets: DraftWidget[];
  issues: Record<string, string>;
  onMove: (activeId: string, overId: string) => void;
  onDraggingChange: (dragging: boolean) => void;
  onResize: (id: string, w: WidgetWidth) => void;
  onConfig: (id: string) => void;
  onRemove: (widget: DraftWidget) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements = useMemo<Announcements>(() => {
    const nameOf = (id: string | number) => `“${widgets.find((w) => w.id === id)?.title ?? 'Ô'}”`;
    const at = (id: string | number) =>
      `vị trí ${widgets.findIndex((w) => w.id === id) + 1}/${widgets.length}`;
    return {
      onDragStart: ({ active }) => `Đã nhấc ô ${nameOf(active.id)}, đang ở ${at(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `Ô ${nameOf(active.id)} ở trên ${at(over.id)}.` : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `Đã thả ô ${nameOf(active.id)} vào ${at(over.id)}.`
          : `Đã thả ô ${nameOf(active.id)} về chỗ cũ.`,
      onDragCancel: ({ active }) => `Đã huỷ kéo ô ${nameOf(active.id)}.`,
    };
  }, [widgets]);

  function onDragEnd(e: DragEndEvent) {
    onDraggingChange(false);
    if (e.over) onMove(String(e.active.id), String(e.over.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => onDraggingChange(true)}
      onDragEnd={onDragEnd}
      onDragCancel={() => onDraggingChange(false)}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className={DASHBOARD_GRID_CLASS}>
          {widgets.map((w, i) => (
            <SortableWidget
              key={w.id}
              widget={w}
              index={i}
              total={widgets.length}
              issue={issues[w.id]}
              onResize={(width) => onResize(w.id, width)}
              onConfig={() => onConfig(w.id)}
              onRemove={() => onRemove(w)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableWidget({
  widget,
  index,
  total,
  issue,
  onResize,
  onConfig,
  onRemove,
}: {
  widget: DraftWidget;
  index: number;
  total: number;
  issue: string | undefined;
  onResize: (w: WidgetWidth) => void;
  onConfig: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: widget.id,
    transition: SORT_TRANSITION,
    attributes: { roleDescription: 'ô dashboard có thể kéo' },
  });
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
      : undefined,
    transition,
  };
  const def = widgetDefOf(widget.type);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex min-w-0 flex-col rounded-lg border border-dashed border-border-strong bg-bg p-1',
        widgetSpanClass(widget.position.w),
        isDragging && 'relative z-10 opacity-70 ring-2 ring-primary',
      )}
    >
      <div className="flex items-center gap-1 px-1 pb-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Kéo để đổi vị trí ô “${widget.title}”, đang ở vị trí ${index + 1}/${total}`}
          className="inline-flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted">
          {def?.label ?? widget.type}
        </span>
        <div
          role="group"
          aria-label={`Cỡ ô “${widget.title}”`}
          className="flex rounded-md border border-border"
        >
          {([1, 2, 3] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={widget.position.w === w}
              title={`Cỡ ${WIDTH_LABEL[w]} — chiếm ${w} cột`}
              onClick={() => onResize(w)}
              className={cn(
                'h-7 w-7 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                widget.position.w === w
                  ? 'bg-primary text-primary-fg'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {WIDTH_LABEL[w]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onConfig}
          aria-label={`Cấu hình ô “${widget.title}”`}
          title="Cấu hình"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Gỡ ô “${widget.title}”`}
          title="Gỡ widget"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {issue && (
        <button
          type="button"
          onClick={onConfig}
          className="mx-1 mb-1 rounded-md bg-warning/10 px-2 py-1 text-left text-xs text-warning-ink hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {issue} — bấm để cấu hình
        </button>
      )}
      {/* Xem trước bằng dữ liệu thật nhưng không tương tác (bấm vào liên kết trong ô sẽ rời trang soạn). */}
      <div
        className="pointer-events-none min-h-0 flex-1 select-none"
        {...({ inert: '' } as object)}
      >
        {def ? (
          <WidgetBoundary title={widget.title}>
            <def.Component title={widget.title} config={widget.config} />
          </WidgetBoundary>
        ) : (
          <WidgetFrame title={widget.title} state="empty" emptyText="Loại ô này chưa được hỗ trợ" />
        )}
      </div>
    </div>
  );
}
