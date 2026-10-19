/**
 * Thuộc tính của công việc nằm ở đâu trên trang chi tiết, theo cỡ màn hình (module thuần).
 * - Từ `lg` trở lên: như trước — trạng thái ở thanh nút, ưu tiên cạnh tiêu đề, phần còn lại ở cột phải.
 * - Dưới `lg`: dải 4 trường chính ngay dưới tiêu đề; phần còn lại gom vào "Thuộc tính khác". Mỗi trường ở đúng MỘT nơi
 *   (cùng một control không bao giờ dựng hai lần trên một trang → id/phím tắt/focus không trùng).
 */
export type FactField =
  | 'status'
  | 'assignee'
  | 'due'
  | 'priority'
  | 'epicParent'
  | 'reporter'
  | 'participants'
  | 'startDate'
  | 'createdAt'
  | 'updatedAt'
  | 'resolvedAt';

/** Dải thuộc tính chính (dưới lg), theo thứ tự hiện. */
export const STRIP_FACTS = ['status', 'assignee', 'due', 'priority'] as const;

/** Phần còn lại của cột phải, gom vào "Thuộc tính khác" (dưới lg). */
export const OTHER_FACTS = [
  'epicParent',
  'reporter',
  'participants',
  'startDate',
  'createdAt',
  'updatedAt',
  'resolvedAt',
] as const satisfies readonly FactField[];

/** Các trường đang nằm ở cột phải trên desktop (trạng thái và ưu tiên nằm ở nơi khác của tiêu đề). */
const SIDEBAR_FACTS = [
  'epicParent',
  'assignee',
  'reporter',
  'participants',
  'startDate',
  'due',
  'createdAt',
  'updatedAt',
  'resolvedAt',
] as const satisfies readonly FactField[];

export interface FactLayout {
  /** Dải ngay dưới tiêu đề. */
  strip: readonly FactField[];
  /** Phần "Thuộc tính khác". */
  other: readonly FactField[];
  /** Cột phải (`<aside>`). */
  sidebar: readonly FactField[];
  /** Chip trạng thái + nút bước kế ở thanh nút dưới tiêu đề. */
  statusInToolbar: boolean;
  /** Ô chọn ưu tiên cạnh loại việc ở hàng tiêu đề. */
  priorityInHeader: boolean;
}

export function factLayout(isDesktop: boolean): FactLayout {
  return isDesktop
    ? {
        strip: [],
        other: [],
        sidebar: SIDEBAR_FACTS,
        statusInToolbar: true,
        priorityInHeader: true,
      }
    : {
        strip: STRIP_FACTS,
        other: OTHER_FACTS,
        sidebar: [],
        statusInToolbar: false,
        priorityInHeader: false,
      };
}

/* ---------------- nhớ "Thuộc tính khác" mở/thu theo người dùng ---------------- */

export type FactStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const otherFactsKey = (userId: string) => `tirapro:issueOtherFacts:v1:${userId}`;

/** Mặc định thu gọn; chỉ chuỗi "1" là mở. */
export const parseOtherOpen = (raw: string | null): boolean => raw === '1';

/** `localStorage` chỉ được chạm BÊN TRONG `try` (chế độ riêng tư/chặn dữ liệu có thể ném ngay khi đọc `window.localStorage`). */
function resolve(storage: FactStorage | null | undefined): FactStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readOtherOpen(key: string | null, storage?: FactStorage | null): boolean {
  if (!key) return false;
  try {
    return parseOtherOpen(resolve(storage)?.getItem(key) ?? null);
  } catch {
    return false;
  }
}

export function writeOtherOpen(key: string, open: boolean, storage?: FactStorage | null): void {
  try {
    const st = resolve(storage);
    if (!st) return;
    if (open) st.setItem(key, '1');
    else st.removeItem(key);
  } catch {
    /* bị chặn: chỉ có hiệu lực trong phiên */
  }
}
