import { create } from 'zustand';
import type { IssueDto } from '@tirapro/types';

/**
 * Hành động GHI từ menu công việc (chuột phải / nút "…"). Menu chỉ dựng nội dung khi mở và biến mất ngay khi chọn, nên
 * phần chạy thật (hộp Cách giải quyết, xác nhận xoá, mutation) nằm ở `IssueActionHost` — một chỗ mount ở khung ứng dụng,
 * sống lâu hơn menu — thay vì mỗi dòng/thẻ giữ hook của mình.
 */
export type IssueAction =
  | { kind: 'transition'; issue: IssueDto; toStatusId: string }
  | { kind: 'priority'; issue: IssueDto; priorityId: string | null; priorityName: string }
  | { kind: 'assignMe'; issue: IssueDto }
  | { kind: 'sprint'; issue: IssueDto; sprintId: string | null; sprintName: string }
  | { kind: 'delete'; issue: IssueDto };

export type IssueActionRequest = IssueAction & { seq: number };

interface State {
  current: IssueActionRequest | null;
  run: (action: IssueAction) => void;
}

let seq = 0;

export const useIssueActionStore = create<State>((set) => ({
  current: null,
  run: (action) => set({ current: { ...action, seq: ++seq } }),
}));

/** Gọi từ menu: giao hành động cho host. */
export const runIssueAction = (action: IssueAction): void =>
  useIssueActionStore.getState().run(action);
