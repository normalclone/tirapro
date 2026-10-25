import { create } from 'zustand';
import type { IssueDto } from '@tirapro/types';

/**
 * Hành động GHI từ menu công việc (chuột phải / nút "…"). Menu chỉ dựng nội dung khi mở và biến mất ngay khi chọn, nên
 * phần chạy thật (hộp Cách giải quyết, xác nhận xoá, mutation) nằm ở `IssueActionHost` — một chỗ mount ở khung ứng dụng,
 * sống lâu hơn menu — thay vì mỗi dòng/thẻ giữ hook của mình.
 */
export type IssueAction =
  | { kind: 'transition'; issue: IssueDto; toStatusId: string }
  | {
      kind: 'priority';
      issue: IssueDto;
      /** Mức được chọn (đối tượng đầy đủ để phủ lạc quan lên Bộ lọc); null = bỏ ưu tiên. */
      priority: IssueDto['priority'];
      priorityName: string;
    }
  | { kind: 'assignMe'; issue: IssueDto }
  | { kind: 'sprint'; issue: IssueDto; sprintId: string | null; sprintName: string }
  | {
      kind: 'delete';
      issue: IssueDto;
      /** Phần tử đã mở menu (dòng/thẻ hoặc nút "…"): hủy hộp xác nhận thì trả focus về đây. */
      returnFocus?: HTMLElement | null;
    };

export type IssueActionRequest = IssueAction & { seq: number };

interface State {
  /** Các hành động đang chạy (mỗi cái một runner); runner tự gỡ khi xong việc (kể cả cửa sổ Hoàn tác). */
  runs: IssueActionRequest[];
}

let seq = 0;

export const useIssueActionStore = create<State>(() => ({ runs: [] }));

/** Gọi từ menu: giao hành động cho host. Hành động mới KHÔNG gạt hành động đang chạy. */
export const runIssueAction = (action: IssueAction): void =>
  useIssueActionStore.setState((s) => ({ runs: [...s.runs, { ...action, seq: ++seq }] }));

/** Runner báo xong → gỡ khỏi host (giải phóng hook theo dự án của việc đó). */
export const finishIssueAction = (id: number): void =>
  useIssueActionStore.setState((s) =>
    s.runs.some((r) => r.seq === id) ? { runs: s.runs.filter((r) => r.seq !== id) } : s,
  );
