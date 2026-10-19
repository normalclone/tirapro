import type { BlockerFunction } from 'react-router-dom';
import { create } from 'zustand';

/** Một nơi cần chặn rời trang (form, bản nháp wiki, dashboard editor...). Các hàm luôn đọc giá trị MỚI NHẤT của chủ sở hữu. */
export interface GuardEntry {
  isDirty: () => boolean;
  shouldBlock: BlockerFunction;
  description: () => string;
  onDiscard: () => void;
}

interface LeaveGuardState {
  entries: Record<string, GuardEntry>;
  /** Đã hỏi và người dùng đồng ý bỏ (vd đổi không gian làm việc, sắp tải lại trang) → `beforeunload` không hỏi lần hai. */
  suspended: boolean;
  set: (id: string, e: GuardEntry) => void;
  remove: (id: string) => void;
  setSuspended: (v: boolean) => void;
}

export const useLeaveGuardStore = create<LeaveGuardState>((set) => ({
  entries: {},
  suspended: false,
  set: (id, e) => set((s) => ({ entries: { ...s.entries, [id]: e } })),
  remove: (id) =>
    set((s) => {
      if (!(id in s.entries)) return s;
      const { [id]: _gone, ...rest } = s.entries;
      return { entries: rest };
    }),
  setSuspended: (suspended) => set({ suspended }),
}));

/** Thuần — mục đang dirty. */
export function dirtyGuardEntries(entries: Record<string, GuardEntry>): [string, GuardEntry][] {
  return Object.entries(entries).filter(([, e]) => e.isDirty());
}

/** Thuần — mục dirty VÀ muốn chặn điều hướng này (`shouldBlock` mặc định = chặn). */
export function pickBlockingEntries(
  entries: Record<string, GuardEntry>,
  args: Parameters<BlockerFunction>[0],
): [string, GuardEntry][] {
  return dirtyGuardEntries(entries).filter(([, e]) => e.shouldBlock(args));
}

const MANY = 'Có nhiều chỗ đang sửa dở. Rời đi bây giờ thì mọi thay đổi chưa lưu sẽ mất.';

/** Thuần — nội dung hộp hỏi: mô tả của mục dirty đầu tiên; nhiều mục thì dùng câu chung. */
export function describeGuard(blocking: [string, GuardEntry][]): string {
  if (blocking.length === 0) return '';
  return blocking.length === 1 ? blocking[0]![1].description() : MANY;
}

/** Bỏ nháp của các mục đang dirty (gọi `onDiscard`); mục sạch giữ nguyên. */
export function discardDirty(entries: Record<string, GuardEntry>): void {
  for (const [, e] of dirtyGuardEntries(entries)) e.onDiscard();
}

/**
 * Thuần — HỎI trước thao tác sẽ tải lại cả trang (đổi/tạo không gian làm việc). Còn mục dirty → `ask(mô tả)`;
 * trả true nếu không có gì dirty hoặc người dùng đồng ý. KHÔNG bỏ nháp: thao tác có thể thất bại, nháp phải còn
 * (bỏ nháp là việc của `commitLeaveApp`, chỉ chạy sau khi thao tác thành công).
 */
export async function confirmLeaveApp(
  entries: Record<string, GuardEntry>,
  ask: (description: string) => Promise<boolean>,
): Promise<boolean> {
  const dirty = dirtyGuardEntries(entries);
  if (dirty.length === 0) return true;
  return ask(describeGuard(dirty));
}

/**
 * Gọi khi thao tác tải-lại ĐÃ THÀNH CÔNG, ngay trước khi tải lại: bỏ nháp các mục dirty và tắt `beforeunload`
 * (đã hỏi rồi, không hỏi lần hai). Thao tác lỗi thì đừng gọi → nháp còn nguyên.
 */
export function commitLeaveApp(): void {
  const s = useLeaveGuardStore.getState();
  try {
    discardDirty(s.entries);
  } finally {
    // `onDiscard` của một mục ném lỗi cũng không được để `beforeunload` còn bật (sẽ hỏi lại ngay trước khi tải lại).
    s.setSuspended(true);
  }
}
