/**
 * Kho phím tắt DUY NHẤT — nguồn sự thật cho bảng `?`, bảng trong trang tài liệu và tooltip trên nút (`withKey`).
 * Thêm/đổi phím ở đây; nơi xử lý phím thật nằm ở `useGlobalHotkeys`, `IssueDetailPage`, `Card`… (kho chỉ khai báo + hiển thị).
 */
export type ShortcutScope = 'issue' | 'board' | 'global';

export interface ShortcutDef {
  id: string;
  /** Các phím theo thứ tự bấm/giữ; mỗi phần tử là một <kbd>. */
  keys: string[];
  label: string;
  scope: ShortcutScope;
  /** Tính năng chưa có → chưa hiện ở bảng `?`/tài liệu/tooltip. */
  pending?: boolean;
  /** Cách hiển thị riêng (vd `1…9` thay vì khai `1-9`). */
  display?: string[];
  /** Bấm lần lượt (g rồi b), không giữ cùng lúc. */
  sequence?: boolean;
}

export const SHORTCUT_GROUPS: { scope: ShortcutScope; title: string }[] = [
  { scope: 'issue', title: 'Trong công việc' },
  { scope: 'board', title: 'Trên bảng việc' },
  { scope: 'global', title: 'Toàn cục' },
];

export const SHORTCUTS: readonly ShortcutDef[] = [
  // Trong công việc (trang chi tiết)
  { id: 'issue.assignMe', keys: ['i'], label: 'Gán cho tôi', scope: 'issue' },
  { id: 'issue.assign', keys: ['a'], label: 'Gán cho người khác', scope: 'issue' },
  { id: 'issue.edit', keys: ['e'], label: 'Sửa tiêu đề', scope: 'issue' },
  { id: 'issue.comment', keys: ['m'], label: 'Viết bình luận', scope: 'issue' },
  { id: 'issue.worklog', keys: ['w'], label: 'Ghi thời gian làm việc', scope: 'issue' },
  { id: 'issue.copyLink', keys: ['y'], label: 'Sao chép liên kết', scope: 'issue' },
  {
    id: 'issue.status',
    keys: ['1-9'],
    display: ['1', '…', '9'],
    label: 'Chuyển sang trạng thái kế tiếp theo quy trình',
    scope: 'issue',
  },
  // Trên bảng việc, Việc chờ, Việc mới vào, kết quả lọc
  {
    id: 'board.next',
    keys: ['j'],
    label: 'Xuống thẻ / dòng kế (đang xem nhanh: xem luôn dòng kế)',
    scope: 'board',
  },
  {
    id: 'board.prev',
    keys: ['k'],
    label: 'Lên thẻ / dòng trước (đang xem nhanh: xem luôn dòng trước)',
    scope: 'board',
  },
  {
    id: 'board.arrows',
    keys: ['←', '↑', '↓', '→'],
    label: 'Di chuyển giữa các thẻ và cột',
    scope: 'board',
  },
  {
    id: 'board.open',
    keys: ['Enter'],
    label: 'Mở xem nhanh (⌘ Enter: mở tab mới)',
    scope: 'board',
  },
  {
    id: 'board.drag',
    keys: ['Space'],
    label: 'Nhấc / thả thẻ để kéo bằng bàn phím',
    scope: 'board',
  },
  {
    id: 'board.assign',
    keys: ['a'],
    label: 'Gán người cho thẻ đang chọn',
    scope: 'board',
  },
  {
    id: 'board.edit',
    keys: ['e'],
    label: 'Mở trang công việc để sửa tiêu đề',
    scope: 'board',
  },
  { id: 'board.esc', keys: ['Esc'], label: 'Huỷ kéo, đóng xem nhanh, bỏ chọn', scope: 'board' },
  {
    id: 'board.ganttMove',
    keys: ['Shift', '←/→'],
    label: 'Lịch trình (Gantt): dời cả thanh ±1 ngày',
    scope: 'board',
  },
  {
    id: 'board.ganttEnd',
    keys: ['Alt', '←/→'],
    label: 'Lịch trình (Gantt): đổi ngày kết thúc',
    scope: 'board',
  },
  {
    id: 'board.ganttStart',
    keys: ['Alt', 'Shift', '←/→'],
    label: 'Lịch trình (Gantt): đổi ngày bắt đầu',
    scope: 'board',
  },
  // Toàn cục
  { id: 'global.palette', keys: ['⌘', 'K'], label: 'Bảng lệnh (Lệnh nhanh)', scope: 'global' },
  { id: 'global.search', keys: ['/'], label: 'Tìm kiếm / bảng lệnh', scope: 'global' },
  { id: 'global.create', keys: ['c'], label: 'Tạo công việc', scope: 'global' },
  {
    id: 'global.goBoard',
    keys: ['g', 'b'],
    label: 'Đi tới Bảng việc',
    scope: 'global',
    sequence: true,
  },
  {
    id: 'global.goBacklog',
    keys: ['g', 'l'],
    label: 'Đi tới Việc chờ',
    scope: 'global',
    sequence: true,
  },
  {
    id: 'global.goHome',
    keys: ['g', 'd'],
    label: 'Đi tới Tổng quan',
    scope: 'global',
    sequence: true,
  },
  {
    id: 'global.esc',
    keys: ['Esc'],
    label: 'Đóng lớp trên cùng (hộp thoại, menu, xem nhanh)',
    scope: 'global',
  },
  { id: 'global.help', keys: ['?'], label: 'Bảng phím tắt này', scope: 'global' },
];

/** Phím của một nhóm, bỏ mục chưa có tính năng (`pending`). */
export function shortcutsOf(scope: ShortcutScope): ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.scope === scope && !s.pending);
}

/** Chuỗi hiển thị của phím (không `pending`), vd `i`, `⌘ K`, `1 … 9`; `undefined` nếu không có/chưa có. */
export function keyLabel(id: string): string | undefined {
  const def = SHORTCUTS.find((s) => s.id === id);
  if (!def || def.pending) return undefined;
  return (def.display ?? def.keys).join(' ');
}

/** Ghép phím vào tooltip: `withKey('Gán cho tôi', 'issue.assignMe')` → `Gán cho tôi · phím i`. Id lạ/chưa có → nhãn gốc. */
export function withKey(label: string, id: string): string {
  const k = keyLabel(id);
  return k ? `${label} · phím ${k}` : label;
}

/** Nhóm ứng với màn hiện tại (để xếp lên đầu bảng `?`): trang công việc → issue; board/việc chờ/việc mới vào → board (Gantt không có j/k/a/e nên không tính). */
export function scopeForPath(pathname: string): ShortcutScope | null {
  if (/^\/issue\//.test(pathname)) return 'issue';
  if (/^\/p\/[^/]+\/(board|backlog|triage)(\/|$)/.test(pathname)) return 'board';
  return null;
}

/** Nhóm theo thứ tự hiển thị: nhóm khớp màn hiện tại lên đầu (`current`), còn lại giữ thứ tự gốc. */
export function orderedGroups(
  pathname: string,
): { scope: ShortcutScope; title: string; current: boolean }[] {
  const cur = scopeForPath(pathname);
  const groups = SHORTCUT_GROUPS.map((g) => ({ ...g, current: g.scope === cur }));
  return [...groups.filter((g) => g.current), ...groups.filter((g) => !g.current)];
}
