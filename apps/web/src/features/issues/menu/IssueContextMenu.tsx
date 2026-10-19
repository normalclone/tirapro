import type { KeyboardEvent, PointerEvent, ReactElement } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { isTypingTarget } from '@/lib/hotkeys';
import { useCoarsePointer } from '@/lib/useCoarsePointer';
import { cn } from '@/lib/utils';
import { IssueMenuItems, MENU_CONTENT_CLS, type MenuKit } from './IssueMenuItems';
import type { MenuSurface } from './issueMenuModel';

const CONTEXT_KIT: MenuKit = {
  Item: ContextMenu.Item,
  Separator: ContextMenu.Separator,
  Sub: ContextMenu.Sub,
  SubTrigger: ContextMenu.SubTrigger,
  SubContent: ContextMenu.SubContent,
  Portal: ContextMenu.Portal,
  RadioGroup: ContextMenu.RadioGroup,
  RadioItem: ContextMenu.RadioItem,
  ItemIndicator: ContextMenu.ItemIndicator,
};

const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenu.Item,
  Separator: DropdownMenu.Separator,
  Sub: DropdownMenu.Sub,
  SubTrigger: DropdownMenu.SubTrigger,
  SubContent: DropdownMenu.SubContent,
  Portal: DropdownMenu.Portal,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem: DropdownMenu.RadioItem,
  ItemIndicator: DropdownMenu.ItemIndicator,
};

/** Phím trong menu (portal nhưng vẫn nổi lên theo cây React) không được lọt vào bộ phím của dòng/thẻ (mũi tên dời thẻ…). */
const stopKeys = (e: KeyboardEvent) => e.stopPropagation();

/**
 * Chuột phải (hoặc Shift+F10 / phím Menu — trình duyệt phát `contextmenu` từ phần tử đang focus) trên một dòng/thẻ → menu
 * công việc. Nội dung là `IssueMenuItems` — cùng nguồn với nút "…" (`IssueRowMenuButton`).
 * - Cảm ứng (`pointer: coarse`): TẮT hẳn — nhấn giữ thuộc về dnd-kit (250ms) và Radix ContextMenu cũng tự mở bằng nhấn giữ
 *   700ms. Trên máy lai (chuột + cảm ứng) nơi `pointer` là fine, nhấn giữ cảm ứng/bút cũng bị chặn bằng `preventDefault`.
 * - Đang gõ (ô nhập, khối sửa tại chỗ): nhường menu gốc của trình duyệt (dán, chính tả).
 * - `display="contents"` cho thẻ mà gốc DOM nằm trong component khác (Board `Card`, Việc chờ `IssueRow`): bọc một div
 *   `display: contents` (không đổi bố cục/khoảng cách); mặc định gắn thẳng lên phần tử con (`tr`, `li`).
 * Nội dung chỉ dựng khi menu mở; không giữ hook theo từng dòng.
 */
export function IssueContextMenu({
  issue,
  surface,
  onPeek,
  display = 'child',
  children,
}: {
  issue: IssueDto;
  surface: MenuSurface;
  onPeek?: (key: string) => void;
  display?: 'child' | 'contents';
  children: ReactElement;
}) {
  const coarse = useCoarsePointer();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        disabled={coarse}
        onContextMenuCapture={(e) => {
          // Chặn ở pha bắt: Radix không thấy sự kiện → menu gốc của trình duyệt hiện như thường.
          if (isTypingTarget(e.target)) e.stopPropagation();
        }}
        onPointerDown={(e: PointerEvent) => {
          if (e.pointerType !== 'mouse') e.preventDefault(); // Radix: nhấn giữ cảm ứng/bút = mở menu; dnd-kit đã giữ 250ms
        }}
      >
        {display === 'contents' ? <div className="contents">{children}</div> : children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={MENU_CONTENT_CLS}
          collisionPadding={8}
          onKeyDown={stopKeys}
          aria-label={`Thao tác cho ${issue.key}`}
        >
          <IssueMenuItems kit={CONTEXT_KIT} issue={issue} surface={surface} onPeek={onPeek} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * Vị trí/hiện của nút "…": ẩn cho tới khi rê chuột vào dòng (`group/row`) hoặc focus nằm trong dòng; luôn hiện trên cảm ứng
 * (vùng bấm mở rộng thành 44px bằng `::after`). Vẫn tab tới được khi đang ẩn (focus → hiện).
 */
export const ROW_MENU_BUTTON_CLS =
  'relative grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2.5';

/**
 * Nút "…" trên mỗi dòng/thẻ: cùng nội dung với menu chuột phải qua DropdownMenu — đường vào cho bàn phím và cảm ứng.
 * Tên truy cập "Thao tác cho {MÃ}". Không để cử chỉ lan sang dòng: bấm/phím trên nút không mở xem nhanh và không bắt đầu
 * kéo (dnd-kit nghe mousedown/touchstart/keydown trên gốc dòng).
 */
export function IssueRowMenuButton({
  issue,
  surface,
  onPeek,
  className,
}: {
  issue: IssueDto;
  surface: MenuSurface;
  onPeek?: (key: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Thao tác cho ${issue.key}`}
          data-no-peek
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={stopKeys}
          className={cn(ROW_MENU_BUTTON_CLS, className)}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={stopKeys}
          aria-label={`Thao tác cho ${issue.key}`}
          className={MENU_CONTENT_CLS}
        >
          <IssueMenuItems kit={DROPDOWN_KIT} issue={issue} surface={surface} onPeek={onPeek} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
