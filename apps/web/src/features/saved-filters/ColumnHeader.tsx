import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useId } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  RESULT_COLUMNS,
  canHideColumn,
  canMoveColumn,
  hiddenColumns,
  type ResultColumnId,
} from './resultColumns';

const MENU_CLS =
  'z-dropdown min-w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none print:hidden';
const ITEM_CLS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm font-normal text-ink outline-none transition-colors data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[disabled]:opacity-60 [@media(pointer:coarse)]:min-h-11';

/**
 * Tiêu đề cột của bảng kết quả: bấm mở menu "Dời trái / Dời phải / Ẩn cột / Hiện lại cột ẩn" (Radix DropdownMenu: bàn phím
 * và trả focus có sẵn). Bảng không có sắp xếp theo cột nên cả tiêu đề là nút mở menu. Mục không dùng được thì VÔ HIỆU
 * (không giấu): cột đầu không dời trái, cột cuối không dời phải, cột hiện cuối cùng / cột khoá không ẩn.
 */
export function ColumnHeader({
  id,
  columns,
  onMove,
  onHide,
  onShow,
}: {
  id: ResultColumnId;
  columns: ResultColumnId[];
  onMove: (id: ResultColumnId, dir: -1 | 1) => void;
  onHide: (id: ResultColumnId) => void;
  onShow: (id: ResultColumnId, afterId: ResultColumnId) => void;
}) {
  const def = RESULT_COLUMNS.find((c) => c.id === id)!;
  const hidden = hiddenColumns(columns);
  const noteId = useId();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-col-trigger={id}
          className={cn(
            '-mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2 data-[state=open]:text-ink [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2.5',
          )}
        >
          {def.label}
          <ChevronDown className="h-3 w-3 shrink-0 text-faint" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          collisionPadding={12}
          sideOffset={4}
          aria-label={`Cột ${def.label}`}
          aria-describedby={def.locked ? noteId : undefined}
          className={MENU_CLS}
        >
          <DropdownMenu.Item
            className={ITEM_CLS}
            disabled={!canMoveColumn(columns, id, -1)}
            onSelect={() => onMove(id, -1)}
          >
            <ArrowLeft className="h-4 w-4 text-muted" aria-hidden />
            Dời trái
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={ITEM_CLS}
            disabled={!canMoveColumn(columns, id, 1)}
            onSelect={() => onMove(id, 1)}
          >
            <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
            Dời phải
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={ITEM_CLS}
            disabled={!canHideColumn(columns, id)}
            onSelect={() => onHide(id)}
          >
            <EyeOff className="h-4 w-4 text-muted" aria-hidden />
            Ẩn cột
          </DropdownMenu.Item>
          {def.locked && (
            <p id={noteId} className="px-2.5 pb-1.5 pt-1 text-xs text-muted">
              Mã và Tiêu đề luôn hiện, ghim ở đầu bảng.
            </p>
          )}
          {hidden.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={cn(ITEM_CLS, 'justify-between')}>
                  <span className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-muted" aria-hidden />
                    Hiện lại cột ẩn
                  </span>
                  <span className="text-xs text-muted" aria-hidden>
                    {hidden.length}
                  </span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    collisionPadding={12}
                    sideOffset={4}
                    className={MENU_CLS}
                  >
                    {hidden.map((c) => (
                      <DropdownMenu.Item
                        key={c.id}
                        className={ITEM_CLS}
                        onSelect={() => onShow(c.id, id)}
                      >
                        {c.label}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
