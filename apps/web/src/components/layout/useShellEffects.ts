import { useEffect } from 'react';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';

/** Các effect của khung ứng dụng: bảng phím tắt, đo lại biểu đồ khi in. */
export function useShellEffects(opts: { setShortcutsOpen: (open: boolean) => void }) {
  const { setShortcutsOpen } = opts;

  // Bảng phím tắt — mở bằng `?` hoặc từ bảng lệnh (sự kiện dùng chung).
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUTS_EVENT, onOpen);
  }, [setShortcutsOpen]);

  // Trình duyệt đổi khổ giấy khi in → nhắc biểu đồ (ResizeObserver) đo lại; không bắn sự kiện thì biểu đồ giữ cỡ màn hình.
  useEffect(() => {
    const relayout = () => window.dispatchEvent(new Event('resize'));
    window.addEventListener('beforeprint', relayout);
    window.addEventListener('afterprint', relayout);
    return () => {
      window.removeEventListener('beforeprint', relayout);
      window.removeEventListener('afterprint', relayout);
    };
  }, []);
}
