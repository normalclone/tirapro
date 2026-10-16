import { useEffect, type RefObject } from 'react';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';

/** Các effect của khung ứng dụng: bảng phím tắt, đóng drawer theo route/Esc, đo lại biểu đồ khi in. */
export function useShellEffects(opts: {
  pathname: string;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  closeRef: RefObject<HTMLButtonElement | null>;
}) {
  const { pathname, navOpen, setNavOpen, setShortcutsOpen, closeRef } = opts;

  // Bảng phím tắt — mở bằng `?` hoặc từ bảng lệnh (sự kiện dùng chung).
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(SHORTCUTS_EVENT, onOpen);
  }, [setShortcutsOpen]);

  // Đóng drawer khi đổi route (điều hướng xong là ẩn).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname, setNavOpen]);

  // Esc để đóng + focus nút đóng khi mở (a11y bàn phím trên mobile).
  useEffect(() => {
    if (!navOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, setNavOpen, closeRef]);

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
