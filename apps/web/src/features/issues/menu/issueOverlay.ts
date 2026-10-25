import { create } from 'zustand';
import type { IssueDto } from '@tirapro/types';

/**
 * Lớp phủ thay đổi lên kết quả Bộ lọc. Kết quả bộ lọc đã lưu nằm trong state của trang (không phải cache dự án) nên
 * sửa một việc từ menu công việc không tự đổi dòng; làm mới cả danh sách thì mất các trang "Tải thêm" và nhảy về trang 1.
 * Thay vào đó host ghi bản mới nhất theo id vào đây, `FiltersPage` phủ lên danh sách đang hiện: thay dòng (nếu phiên bản
 * mới hơn) và ẩn dòng đã xoá — không refetch, trang và phần đã nạp giữ nguyên.
 */
export interface OverlayEntry {
  /** Việc do máy chủ trả (hoặc phần vá lạc quan) — gộp đè lên dòng. */
  patch?: Partial<IssueDto>;
  /** Phiên bản của `patch`; chỉ thay dòng khi lớn hơn phiên bản dòng. */
  version: number;
  deleted?: boolean;
}

export type ResultOverlay = ReadonlyMap<string, OverlayEntry>;

/**
 * Phủ lên danh sách: dòng đã xoá bị ẩn; dòng có bản mới hơn được thay (giữ vị trí). Không có gì để phủ → trả CHÍNH mảng
 * đầu vào (tham chiếu ổn định để các memo/đồng bộ trang phía sau không bị kích). Không sửa đầu vào.
 */
export function applyOverlay(items: IssueDto[], overlay: ResultOverlay): IssueDto[];
export function applyOverlay(items: IssueDto[] | null, overlay: ResultOverlay): IssueDto[] | null;
export function applyOverlay(items: IssueDto[] | null, overlay: ResultOverlay): IssueDto[] | null {
  if (!items || overlay.size === 0) return items;
  let changed = false;
  const out: IssueDto[] = [];
  for (const row of items) {
    const e = overlay.get(row.id);
    if (!e) {
      out.push(row);
      continue;
    }
    if (e.deleted) {
      changed = true;
      continue;
    }
    if (e.patch && e.version > row.version) {
      changed = true;
      out.push({ ...row, ...e.patch, version: e.version });
      continue;
    }
    out.push(row);
  }
  return changed ? out : items;
}

interface State {
  entries: ReadonlyMap<string, OverlayEntry>;
}

export const useIssueOverlayStore = create<State>(() => ({ entries: new Map() }));

const isIssueLike = (x: unknown): x is Partial<IssueDto> & { id: string; version: number } =>
  !!x &&
  typeof (x as { id?: unknown }).id === 'string' &&
  typeof (x as { version?: unknown }).version === 'number';

/** Ghi bản mới của một việc (phản hồi máy chủ hoặc phần vá lạc quan). Bản cũ hơn bản đã có bị bỏ; dạng sai bị bỏ. */
export function recordIssueChange(
  issue: Partial<IssueDto> & { id: string; version: number },
): void {
  if (!isIssueLike(issue)) return;
  useIssueOverlayStore.setState((s) => {
    const cur = s.entries.get(issue.id);
    if (cur && !cur.deleted && cur.version >= issue.version) return s;
    const next = new Map(s.entries);
    next.set(issue.id, { patch: issue, version: issue.version });
    return { entries: next };
  });
}

/** Việc đã xoá (từ menu): dòng bị ẩn. */
export function recordIssueDeleted(id: string): void {
  useIssueOverlayStore.setState((s) => {
    const next = new Map(s.entries);
    next.set(id, { deleted: true, version: 0 });
    return { entries: next };
  });
}

/** Đổi nguồn kết quả → bỏ lớp phủ. */
export function clearIssueOverlay(): void {
  useIssueOverlayStore.setState((s) => (s.entries.size === 0 ? s : { entries: new Map() }));
}
