import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { registerPeekSource } from '@/lib/peekRegistry';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useRetainedFor } from '@/lib/useRetained';
import { IssuePeekPanel } from './IssuePeekPanel';
import { PeekOrderContext, type PeekOrder } from './PeekOrderContext';
import { PEEK_DESKTOP_QUERY, peekSurface, SHEET_EXIT_MS } from './peekSheetLogic';
import { useIssuePeek } from './useIssuePeek';

/**
 * Bố cục hàng [nội dung | panel xem nhanh]: panel hiện khi URL có `?peek=KEY`. Dùng cho Việc chờ / Triage / Board / Bộ lọc / Cây.
 * `order`: thứ tự THẬT của danh sách trang (xem `PeekOrder`) — trang có dòng chưa vẽ (ảo hoá, phân trang) phải truyền; không
 * truyền thì panel đọc thứ tự DOM (đủ cho Board/Triage: không ảo hoá). Đưa vào context cho panel và đăng ký cho phím j/k.
 */
export function PeekShell({ children, order }: { children: ReactNode; order?: PeekOrder }) {
  const { peekKey, open, close } = useIssuePeek();
  // Dưới md xem nhanh là sheet modal: giữ cây thêm một chút sau khi đóng để Radix phát hiệu ứng đóng (hợp đồng Dialog).
  const sheet = peekSurface(useMediaQuery(PEEK_DESKTOP_QUERY, true)) === 'sheet';
  const retainedKey = useRetainedFor(peekKey, SHEET_EXIT_MS);
  const shownKey = peekKey ?? (sheet ? retainedKey : null);
  const listRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<PeekOrder | null>(order ?? null);
  orderRef.current = order ?? null;
  useEffect(
    () => registerPeekSource({ getRoot: () => listRef.current, getOrder: () => orderRef.current }),
    [],
  );
  const value = useMemo(() => ({ listRef, order: order ?? null }), [order]);
  return (
    <PeekOrderContext.Provider value={value}>
      <div className="flex h-full min-h-0">
        <div ref={listRef} className="flex min-w-0 flex-1 flex-col">
          {children}
        </div>
        {shownKey && (
          <IssuePeekPanel
            issueKey={shownKey}
            open={!!peekKey}
            sheet={sheet}
            onClose={close}
            onNavigate={open}
          />
        )}
      </div>
    </PeekOrderContext.Provider>
  );
}
