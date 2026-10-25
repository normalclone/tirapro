import {
  memo,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { IssueDto } from '@tirapro/types';
import { DueBadge, dueBorderClass } from '@/components/ui/DueBadge';
import { AcceptanceBadge } from '@/components/ui/AcceptanceBadge';
import { TaskProgress } from '@/components/ui/TaskProgress';
import { IssueTypeBadge } from '@/components/ui/IssueTypeBadge';
import { Avatar } from '@/components/ui/primitives';
import { PriorityIcon } from '@/components/ui/PriorityIcon';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { usePriorityRanks } from '@/features/issue-meta/usePriorityRanks';
import { isBugType } from '@/features/issue-edit/severity';
import { cn } from '@/lib/utils';
import { useDropEdge } from '@/lib/dropHint';
import { SORT_TRANSITION } from '@/lib/sortableDnd';
import { sameProgress, type SubtreeProgress } from '@/lib/issueTree';
import { openOnRowKey } from '@/lib/rowOpen';
import { COARSE_NO_CALLOUT } from '@/lib/dragTouch';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { PEEKED_ROW_CLS, peekedAttrs } from '@/features/issues/peek/peekedRow';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';
import { labelToneStyle } from '@/lib/labelPalette';
import { IssueContextMenu, IssueRowMenuButton } from '@/features/issues/menu/IssueContextMenu';
import {
  BulkSelectionContext,
  useHasSelection,
  useIsSelected,
} from '@/features/bulk/bulkSelectionContext';
import { SelectCheckbox } from '@/features/bulk/SelectCheckbox';
import { selectGesture } from '@/features/bulk/selectGesture';
import { cardLayout, type CardDisplay } from './cardDisplay';
import { CardDisplayContext } from './cardDisplayContext';

/** Roving focus giữa các card bằng phím mũi tên (theo data-lane/col/row). */
function focusCard(lane: number, col: number, row: number): boolean {
  const el = document.querySelector<HTMLElement>(
    `[data-board-card][data-lane="${lane}"][data-col="${col}"][data-row="${row}"]`,
  );
  if (el) {
    el.focus();
    return true;
  }
  return false;
}

/** Chip nhãn nhỏ trên card. */
const LabelChip = memo(function LabelChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="max-w-[8rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
      style={labelToneStyle(color)}
      title={`Nhãn: ${name}`}
    >
      {name}
    </span>
  );
});

/** Người phụ trách ở góc phải dưới của thẻ ("Chưa gán" khi trống). */
function CardAssignee({ assignee }: { assignee: IssueDto['assignee'] }) {
  return (
    <div className="ml-auto flex min-w-0 items-center">
      {assignee ? (
        <span
          className="flex min-w-0 items-center gap-1"
          title={`Người phụ trách: ${assignee.displayName}`}
        >
          <Avatar name={assignee.displayName} src={assignee.avatarUrl} size={18} />
          <span className="max-w-[6.5rem] truncate text-xs text-muted">{assignee.displayName}</span>
        </span>
      ) : (
        <span className="whitespace-nowrap text-[11px] text-faint" title="Chưa có ai nhận việc này">
          Chưa gán
        </span>
      )}
    </div>
  );
}

/**
 * Phần giao diện thuần của thẻ — dùng cho cả thẻ kéo được (`Card`) lẫn bản trôi theo chuột (`DragOverlay`).
 * Bản overlay KHÔNG gọi `useSortable` để không đăng ký trùng id với thẻ gốc trong dnd-kit.
 */
export function CardBody({
  issue,
  progress,
  overlay,
  isDragging,
  canDrag = true,
  style,
  dropEdge,
  rootRef,
  rootProps,
  onOpenKey,
  peeked,
  display,
  menu,
  selectBox,
  selected,
}: {
  issue: IssueDto;
  progress?: SubtreeProgress;
  overlay?: boolean;
  isDragging?: boolean;
  /** false = không có quyền chuyển cột: không hiện con trỏ nắm/kéo, cuộn cảm ứng bình thường. */
  canDrag?: boolean;
  /** Dịch chỗ khi các thẻ khác tránh đường (transform/transition của sortable). */
  style?: CSSProperties;
  /** Đường kẻ chèn khi một thẻ từ cột khác đang rê tới: ngay trước/sau thẻ này. */
  dropEdge?: 'before' | 'after' | null;
  rootRef?: Ref<HTMLDivElement>;
  rootProps?: HTMLAttributes<HTMLDivElement>;
  /** Có → mã công việc là link thật (bấm = xem nhanh, Cmd/Ctrl+bấm = tab mới). Bản overlay không truyền. */
  onOpenKey?: (key: string) => void;
  /** Đang được xem nhanh ở panel phải: tô nền + vòng (token) và `aria-current`. */
  peeked?: boolean;
  /** Ghi đè tuỳ chọn hiển thị (xem trước trong popover); bỏ trống = tuỳ chọn của người dùng từ context. */
  display?: CardDisplay;
  /** Nút "…" (menu công việc) trong hàng mã; bản overlay/xem trước không truyền. */
  menu?: ReactNode;
  /** Ô chọn nhiều ở góc trên-trái (chỉ thẻ thật); bản overlay/xem trước không truyền. */
  selectBox?: ReactNode;
  /** Thẻ đang được chọn (viền + nền `primary`; ô chọn đã cho biết trạng thái nên không chỉ dựa vào màu). */
  selected?: boolean;
}) {
  const fromContext = useContext(CardDisplayContext);
  const { fields } = display ?? fromContext;
  const layout = cardLayout((display ?? fromContext).density);
  const labels = issue.labels ?? [];
  const ranks = usePriorityRanks();
  return (
    <div
      ref={rootRef}
      {...rootProps}
      {...peekedAttrs(peeked)}
      style={style}
      className={cn(
        'group/row relative rounded-md border bg-surface shadow-sm transition-shadow',
        layout.pad,
        canDrag
          ? `cursor-grab touch-manipulation active:cursor-grabbing ${COARSE_NO_CALLOUT}`
          : 'cursor-pointer',
        selected ? 'border-primary bg-primary-subtle' : dueBorderClass(issue) || 'border-border',
        'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        isDragging && 'opacity-40',
        peeked && PEEKED_ROW_CLS,
        overlay && 'shadow-lg',
      )}
    >
      {selectBox}
      <div className={cn(layout.gap, 'flex items-center gap-2')}>
        <IssueTypeBadge name={issue.type.name} color={issue.type.color} />
        <div
          className={cn(
            'ml-auto flex items-center gap-2',
            // Cảm ứng: nút "…" ở góc trên phải (vùng bấm 44px) → chừa chỗ để không đè chip hạn/điểm.
            menu && '[@media(pointer:coarse)]:pr-10',
          )}
        >
          <DueBadge issue={issue} warnOnly />
          {fields.points && issue.storyPoints != null && (
            <span
              className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-medium text-muted"
              title={`${issue.storyPoints} điểm ước lượng — mức độ lớn của việc này`}
            >
              {issue.storyPoints}
            </span>
          )}
        </div>
      </div>

      <p className={cn(layout.gap, layout.title, 'text-sm text-ink-strong')}>{issue.summary}</p>

      {fields.labels && labels.length > 0 && (
        <div className={cn(layout.gap, 'flex flex-wrap items-center gap-1')}>
          {labels.slice(0, layout.labelMax).map((l) => (
            <LabelChip key={l.id} name={l.name} color={l.color} />
          ))}
          {labels.length > layout.labelMax && (
            <span className="text-[10px] text-faint">+{labels.length - layout.labelMax}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {onOpenKey && !overlay ? (
          <IssueKeyLink issueKey={issue.key} onPeek={onOpenKey} className="whitespace-nowrap" />
        ) : (
          <span
            className="shrink-0 whitespace-nowrap font-mono text-xs text-muted"
            title={`Mã công việc ${issue.key}`}
          >
            {issue.key}
          </span>
        )}
        {fields.priority && issue.priority && (
          <PriorityIcon
            name={issue.priority.name}
            rank={issue.priority.rank}
            ranks={ranks}
            color={issue.priority.color}
          />
        )}
        <AcceptanceBadge progress={issue.acceptanceProgress} />
        {issue.severity && isBugType(issue.type) && (
          <SeverityBadge severity={issue.severity} compact />
        )}
        {/* Chuột: nút "…" nằm TRONG hàng mã (khoảng trống giữa mã và người phụ trách): không đè chip hạn/điểm ở hàng trên. Cảm ứng: nút ra góc trên phải thẻ (CARD_MENU_COARSE_CLS). */}
        {menu}
        {fields.assignee && <CardAssignee assignee={issue.assignee} />}
      </div>

      {fields.progress && progress && progress.total > 0 && (
        <div
          className={cn(layout.progressTop, 'flex items-center gap-1.5')}
          title={`Việc con: đã xong ${progress.done}/${progress.total}`}
        >
          <TaskProgress progress={progress} compact className="flex-1" />
          <span className="tabular shrink-0 text-[10px] text-faint">
            {progress.done}/{progress.total}
          </span>
        </div>
      )}

      {dropEdge && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary',
            dropEdge === 'before' ? '-top-[5px]' : '-bottom-[5px]',
          )}
        />
      )}
    </div>
  );
}

/**
 * Cảm ứng: đưa nút "…" ra GÓC TRÊN PHẢI của thẻ. Ở hàng mã, vùng bấm 44px (`::after`) của nút nằm cách tâm thẻ chỉ vài px khi
 * mã dài, và Chrome hút cú chạm giữa thẻ vào nút đó (mở menu thay vì xem nhanh). Chuột giữ nguyên vị trí trong hàng mã.
 */
const CARD_MENU_COARSE_CLS =
  '[@media(pointer:coarse)]:absolute [@media(pointer:coarse)]:right-1 [@media(pointer:coarse)]:top-1';

interface CardProps {
  issue: IssueDto;
  progress?: SubtreeProgress;
  onOpen: (key: string) => void;
  /** Thẻ này đang được xem nhanh (xem `CardBody.peeked`). */
  peeked?: boolean;
  laneIdx?: number;
  colIdx?: number;
  rowIdx?: number;
  /** Có quyền chuyển cột (`issue:transition`) không — false thì thẻ chỉ mở chi tiết, không kéo được. */
  canDrag: boolean;
}

/**
 * Thẻ công việc kéo được. `memo` với so sánh tiến độ theo giá trị: bản đồ tiến độ được dựng lại mỗi lần cache đổi
 * nhưng thẻ không có việc con đổi thì không cần vẽ lại.
 */
export const Card = memo(
  function Card({
    issue,
    progress,
    onOpen,
    peeked,
    laneIdx = 0,
    colIdx = 0,
    rowIdx = 0,
    canDrag,
  }: CardProps) {
    // Không quyền kéo: thẻ vẫn là droppable để người có quyền thả gần nó (chỉ tắt phần draggable).
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: issue.id,
      disabled: { draggable: !canDrag },
      transition: SORT_TRANSITION,
      attributes: { roleDescription: canDrag ? 'thẻ việc có thể kéo' : 'thẻ việc' },
    });
    const dropEdge = useDropEdge(issue.id);
    // Chọn nhiều: kho nằm trong context ổn định; thẻ chỉ đăng ký "mình có được chọn không" nên đổi lựa chọn không vẽ lại cả bảng.
    const bulk = useContext(BulkSelectionContext);
    const selected = useIsSelected(bulk?.store, issue.id);
    const selecting = useHasSelection(bulk?.store);
    const style: CSSProperties = {
      transform: transform
        ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
        : undefined,
      transition,
    };

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (isDragging) return; // đang kéo bằng bàn phím: mũi tên thuộc về dnd-kit, không dời focus
      if (openOnRowKey(e, { key: issue.key, open: onOpen })) return; // Enter = xem nhanh, Cmd/Ctrl+Enter = tab mới
      if (e.key === ' ') {
        listeners?.onKeyDown?.(e);
        return;
      } // Space nhấc thẻ để kéo bằng bàn phím
      // Mũi tên phát từ điều khiển BÊN TRONG thẻ (ô chọn, nút "…") thuộc về điều khiển đó, không dời thẻ.
      if (e.target !== e.currentTarget) return;
      const map: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      const [dc, dr] = d;
      if (!focusCard(laneIdx, colIdx + dc, rowIdx + dr) && dc !== 0)
        focusCard(laneIdx, colIdx + dc, 0);
    }

    /** Shift+click = chọn dải, Cmd/Ctrl+click = bật/tắt thẻ (không trên link mã); click thường vẫn mở xem nhanh. */
    function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
      const t = e.target as Element;
      if (!bulk || !e.currentTarget.contains(t) || t.closest('[data-no-peek], button')) return;
      const act = selectGesture(e, !!t.closest('a'));
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === 'range') bulk.range(issue.id);
      else bulk.toggle(issue.id);
    }
    /** Shift+mousedown không được bôi đen chữ (chọn dải); không đụng dnd (nghe pointerdown). */
    function onMouseDownCapture(e: React.MouseEvent<HTMLDivElement>) {
      if (bulk && e.shiftKey && e.currentTarget.contains(e.target as Node)) e.preventDefault();
    }

    return (
      <IssueContextMenu issue={issue} surface="board" onPeek={onOpen} display="contents">
        <CardBody
          issue={issue}
          progress={progress}
          selected={selected}
          selectBox={
            bulk && (
              <SelectCheckbox
                issueKey={issue.key}
                checked={selected}
                alwaysVisible={selecting}
                onToggle={() => bulk.toggle(issue.id)}
                onRange={() => bulk.range(issue.id)}
              />
            )
          }
          menu={
            <IssueRowMenuButton
              issue={issue}
              surface="board"
              onPeek={onOpen}
              className={CARD_MENU_COARSE_CLS}
            />
          }
          isDragging={isDragging}
          canDrag={canDrag}
          style={style}
          dropEdge={dropEdge}
          rootRef={setNodeRef}
          onOpenKey={onOpen}
          peeked={peeked}
          rootProps={{
            ...listeners,
            ...attributes,
            ...({
              'data-board-card': true,
              'data-nav-item': true,
              'data-lane': laneIdx,
              'data-col': colIdx,
              'data-row': rowIdx,
              'data-issue-key': issue.key,
              'data-selected': selected ? '' : undefined,
            } as object),
            ...rowPeekProps(issue.key, onOpen),
            role: 'button',
            tabIndex: 0,
            onKeyDown,
            onClickCapture,
            onMouseDownCapture,
          }}
        />
      </IssueContextMenu>
    );
  },
  (prev, next) =>
    prev.issue === next.issue &&
    prev.onOpen === next.onOpen &&
    prev.peeked === next.peeked &&
    prev.laneIdx === next.laneIdx &&
    prev.colIdx === next.colIdx &&
    prev.rowIdx === next.rowIdx &&
    prev.canDrag === next.canDrag &&
    sameProgress(prev.progress, next.progress),
);
