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

/** Câu báo khi không được đổi người phụ trách (phím `a`, thả thẻ sang hàng người khác trên Board). */
export const ASSIGN_DENIED_NOTICE = 'Bạn không có quyền đổi người phụ trách việc này.';
