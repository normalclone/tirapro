import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { hasDraftText } from '@/lib/hotkeys';
import {
  nextSnap,
  PEEK_SHEET_HALF_ATTR,
  sheetClass,
  sheetCoversListBottom,
  sheetEscapeAction,
  snapToggleLabel,
  type PeekSnap,
} from './peekSheetLogic';

/**
 * Hàng đầu sheet: nút tay nắm giữa (đổi nấc nửa ↔ đầy) + nút đóng bên phải, đều có vùng bấm 44px.
 * Tay nắm là `button` thật (không kéo-thả): tên theo nấc hiện tại, `aria-expanded` = đang ở nấc đầy.
 */
export function PeekSheetHandle({ snap, onToggle }: { snap: PeekSnap; onToggle: () => void }) {
  return (
    <div className="relative flex h-11 shrink-0 items-center justify-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={snap === 'full'}
        aria-label={snapToggleLabel(snap)}
        className="grid h-11 w-28 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span aria-hidden className="h-1 w-8 rounded-full bg-border-strong" />
      </button>
      <RadixDialog.Close
        aria-label="Đóng xem nhanh"
        className="absolute right-1 top-0 grid h-11 w-11 place-items-center rounded-md text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <X className="h-4 w-4" aria-hidden />
      </RadixDialog.Close>
    </div>
  );
}

/**
 * Xem nhanh dạng sheet đáy cho điện thoại (dưới md): `Dialog placement="bottom"` (modal: focus-trap, Esc, nền tối). Phần đầu
 * (`header`) cố định, `children` (PeekBody) tự cuộn bên trong nên nấc nửa vẫn đọc được hết. Khung `data-peek-panel` để các nơi
 * nhận biết "Esc đến từ xem nhanh" (BulkDock không bỏ chọn, ô nháp chỉ rời ô).
 */
export function PeekSheet({
  issueKey,
  open,
  onClose,
  header,
  returnFocus,
  listRef,
  children,
}: {
  issueKey: string;
  /** `false` trong lúc chạy hiệu ứng đóng — Dialog luôn mount với `open` thật. */
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  /** Trả focus về thẻ/dòng đã mở khi sheet đóng (Radix không có nút mở để trả về). */
  returnFocus: () => void;
  /** Khung danh sách của trang — được đánh dấu khi sheet che nửa dưới để thẻ được ‹ › đưa vào không nằm sau sheet. */
  listRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [snap, setSnap] = useState<PeekSnap>('half');
  const covers = sheetCoversListBottom(open, snap);
  useEffect(() => {
    const list = listRef.current;
    list?.toggleAttribute(PEEK_SHEET_HALF_ATTR, covers);
    return () => list?.removeAttribute(PEEK_SHEET_HALF_ATTR);
  }, [covers, listRef]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Xem nhanh ${issueKey}`}
      hideTitle
      placement="bottom"
      hideClose
      handle={<PeekSheetHandle snap={snap} onToggle={() => setSnap(nextSnap)} />}
      className={sheetClass(snap)}
      bodyClassName="flex flex-col overflow-hidden p-0"
      onOpenAutoFocus={(e) => {
        // Focus vào khung sheet (không rơi vào nút tay nắm) — như panel focus vào khung của nó.
        e.preventDefault();
        (e.target as HTMLElement | null)?.focus?.({ preventScroll: true });
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        returnFocus();
      }}
      onEscapeKeyDown={(e) => {
        const t = e.target as HTMLElement | null;
        const act = sheetEscapeAction({
          isComposing: e.isComposing,
          inInlineEdit: !!t?.closest?.('[data-inline-edit]'),
          draftFocused: !!t?.closest?.('[data-peek-panel]') && hasDraftText(t),
        });
        if (act === 'close') return;
        e.preventDefault(); // chặn Radix đóng
        if (act === 'blur') t?.blur();
      }}
    >
      <div data-peek-panel className="flex min-h-0 flex-1 flex-col">
        {header}
        {children}
      </div>
    </Dialog>
  );
}
