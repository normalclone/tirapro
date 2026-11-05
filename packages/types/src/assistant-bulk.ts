/**
 * Hợp đồng API "thao tác hàng loạt qua Trợ lý" (`POST /assistant/bulk/assign|members`).
 * Máy chủ kiểm quyền TỪNG DÒNG lúc thực hiện (không tin web) và trả kết quả từng dòng; Hoàn tác dùng lại chính hai API này
 * với trạng thái "trước" của các dòng đã đổi thật.
 */
export type AssistantBulkRowStatus = 'ok' | 'skipped' | 'failed';

export interface AssistantBulkAssignRowInput {
  issueId: string;
  /** Version việc lúc xem trước (OCC). Lệch → dòng bị bỏ qua, không ghi đè thay đổi của người khác. */
  version: number;
  /** `null` = bỏ người phụ trách (dùng cho Hoàn tác). */
  assigneeId: string | null;
}

export interface AssistantBulkAssignRowResult {
  issueId: string;
  key: string | null;
  status: AssistantBulkRowStatus;
  /** Lý do tiếng Việt khi `skipped`/`failed`. */
  reason?: string;
  /** Người phụ trách TRƯỚC khi đổi (chỉ chắc chắn khi `status = ok`). */
  previousAssigneeId: string | null;
  /** Người phụ trách hiện tại của việc sau lệnh. */
  assigneeId: string | null;
  /** Version hiện tại của việc (ok: sau khi ghi; conflict: version đang có). null nếu không tìm thấy. */
  version: number | null;
}

export interface AssistantBulkAssignResult {
  results: AssistantBulkAssignRowResult[];
}

/**
 * So-sánh-rồi-đặt vai trò RIÊNG của một người trong một dự án. `expect` = bộ vai trò riêng máy chủ phải đang thấy
 * (`null` = chưa có vai trò riêng); `set` = bộ vai trò muốn đặt (`null` = gỡ vai trò riêng). `expect` không khớp → bỏ qua.
 * Một nguyên thể dùng cho thêm, gỡ và Hoàn tác.
 */
export interface AssistantBulkMemberRowInput {
  projectId: string;
  userId: string;
  expect: string[] | null;
  set: string[] | null;
}

export interface AssistantBulkMemberRowResult {
  projectId: string;
  userId: string;
  status: AssistantBulkRowStatus;
  reason?: string;
  /** Vai trò riêng TRƯỚC (null = chưa có) và SAU lệnh. */
  before: string[] | null;
  after: string[] | null;
}

export interface AssistantBulkMembersResult {
  results: AssistantBulkMemberRowResult[];
}
