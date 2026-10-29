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

export interface LinkItem {
  title: string;
  summary: string;
  /** Đường dẫn nội bộ (router) — không bao giờ là URL ngoài. */
  to: string;
  linkLabel: string;
  /** Nút phụ (vd "Mở Nhập dữ liệu của dự án"). */
  extra?: { label: string; to: string };
}

export type DraftStatus = 'pending' | 'creating' | 'created' | 'cancelled' | 'failed';

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
    };
