/** Phím `a` (hoặc lệnh khác) xin mở hộp chọn người phụ trách: `{ detail: { issueKey } }`. Nghe ở `QuickAssignDialog`. */
export const ASSIGN_REQUEST_EVENT = 'tirapro:assign';

export interface AssignRequestDetail {
  issueKey: string;
}

export function requestAssign(issueKey: string): void {
  window.dispatchEvent(
    new CustomEvent<AssignRequestDetail>(ASSIGN_REQUEST_EVENT, { detail: { issueKey } }),
  );
}
