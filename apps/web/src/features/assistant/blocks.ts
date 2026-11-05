import type { BulkCard, BulkOutcome } from './bulkPreview';
import type { Draft } from './draft';

/** Một dòng việc trong danh sách trả lời (chỉ chữ thuần — panel hiển thị dạng TEXT, không HTML). */
export interface IssueRow {
  key: string;
  summary: string;
  status: string;
  /** `dd/mm/yyyy` hoặc null. */
  due: string | null;
  overdue: boolean;
}

/** Chip gợi ý: bấm = gửi `text` như người dùng gõ; `projectKey` = chọn dự án cho lệnh tạo việc. */
export interface Chip {
  label: string;
  text: string;
  projectKey?: string;
}

interface LinkItem {
  title: string;
  summary: string;
  /** Đường dẫn nội bộ (router) — không bao giờ là URL ngoài. */
  to: string;
  linkLabel: string;
  /** Nút phụ (vd "Mở Nhập dữ liệu của dự án"). */
  extra?: { label: string; to: string };
}

/** `opened` = đã chuyển sang form tạo việc đầy đủ (thẻ không còn là nơi tạo nữa). */
export type DraftStatus = 'pending' | 'creating' | 'created' | 'cancelled' | 'failed' | 'opened';

/**
 * Trạng thái thẻ lệnh hàng loạt. `interrupted` = phiên đóng giữa lúc đang chạy (kết quả không rõ, KHÔNG tự chạy lại);
 * `failed` = lệnh gọi máy chủ lỗi (có thể bấm Xác nhận lại — dòng đã đổi sẽ tự bị bỏ qua nhờ OCC).
 */
export type BulkStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'undoing'
  | 'undone'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Khối nội dung của một tin nhắn trợ lý. Tất cả là dữ liệu thuần, serialize được (lưu sessionStorage). */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'links'; items: LinkItem[] }
  | { type: 'issues'; rows: IssueRow[]; more: boolean; seeAllTo: string }
  | {
      type: 'facts';
      title: string;
      rows: { label: string; value: string }[];
      to?: { label: string; to: string };
    }
  | { type: 'tour'; label: string }
  | { type: 'chips'; chips: Chip[] }
  | {
      type: 'draft';
      draft: Draft;
      status: DraftStatus;
      createdKey?: string;
      error?: string;
    }
  | {
      type: 'bulk';
      card: BulkCard;
      status: BulkStatus;
      outcome?: BulkOutcome;
      undoOutcome?: BulkOutcome;
      error?: string;
      /** Câu lệnh gốc — để tải lại xem trước từ trạng thái máy chủ khi không rõ kết quả. */
      raw?: string;
      /** Thông báo hiển thị trên thẻ (vd "Có thể đã áp dụng một phần — đã tải lại xem trước"). */
      notice?: string;
      /** Tăng mỗi lần xem trước được tải lại (khoá của thẻ → trạng thái chọn của người dùng được làm mới). */
      rev?: number;
    };
