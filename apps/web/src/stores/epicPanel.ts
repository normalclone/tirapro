import { create } from 'zustand';

/** Panel Epic của Việc chờ mở/thu — nhớ theo máy (mặc định mở). */
const EPIC_PANEL_KEY = 'tirapro:backlog:epicPanel';

function readOpen(): boolean {
  try {
    return localStorage.getItem(EPIC_PANEL_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(EPIC_PANEL_KEY, open ? 'open' : 'closed');
  } catch {
    /* bỏ qua: chế độ riêng tư / bị chặn lưu trữ */
  }
}

/**
 * Nguồn trạng thái chung của panel Epic: BacklogPage vẽ panel, ProjectRail đọc để thu tạm khi panel mở (F2).
 * Đọc đồng bộ khi nạp module → vẽ đúng ngay lần đầu, không nháy khi tải trang.
 */
export const useEpicPanel = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}>((set, get) => ({
  open: readOpen(),
  setOpen: (open) => {
    writeOpen(open);
    set({ open });
  },
  toggle: () => get().setOpen(!get().open),
}));

/**
 * Panel Epic thực sự hiện hay không: xem nhanh mở ở khổ hẹp (lg..2xl) thì panel Epic tự thu TẠM để danh sách không
 * bị ép — KHÔNG ghi vào lựa chọn của người dùng, đóng xem nhanh là panel về đúng trạng thái đã chọn.
 */
export function epicPanelShown(userOpen: boolean, peekOpen: boolean, squeezed: boolean): boolean {
  return userOpen && !(peekOpen && squeezed);
}
