/**
 * Báo cáo định kỳ (digest) — mô hình nội dung có cấu trúc, dùng chung cho API (dựng + render Telegram/email/text)
 * và giao diện (nhãn khối, gợi ý). Nội dung là VĂN BẢN THUẦN: escape HTML chỉ làm MỘT lần ở lớp render của từng kênh.
 */
export const DIGEST_BLOCKS = [
  { id: 'summary', label: 'Tổng kết tuần', hint: 'Tạo mới / đã xong / đang mở trong 7 ngày' },
  { id: 'overdue', label: 'Việc quá hạn', hint: 'Số việc quá hạn và 3 việc trễ nhất' },
  { id: 'sprint', label: 'Sprint đang chạy', hint: 'Tên, điểm còn lại, số ngày còn lại' },
  { id: 'risks', label: 'Rủi ro nghiêm trọng', hint: '3 rủi ro mở điểm cao nhất' },
  { id: 'okr', label: 'OKR chậm', hint: 'Mục tiêu đang chậm so với thời gian' },
  { id: 'workload', label: 'Người quá tải', hint: 'Người có tải vượt năng lực trong 2 tuần tới' },
  { id: 'health', label: 'Sức khoẻ dự án', hint: 'Dự án không ở mức Tốt kèm lý do' },
] as const;

export type DigestBlockId = (typeof DIGEST_BLOCKS)[number]['id'];

export const DIGEST_BLOCK_IDS = DIGEST_BLOCKS.map((b) => b.id) as [
  DigestBlockId,
  ...DigestBlockId[],
];

/** Digest tạo mới từ form: 4 khối đầu. */
export const DEFAULT_DIGEST_BLOCKS: readonly DigestBlockId[] = [
  'summary',
  'overdue',
  'sprint',
  'risks',
];

/** Digest cũ (cột `metrics` rỗng) = nội dung đã gửi trước đây: giữ nguyên hành vi. */
export const LEGACY_DIGEST_BLOCKS: readonly DigestBlockId[] = ['summary', 'sprint'];

/** Khối chỉ có nghĩa ở cấp workspace — bỏ qua khi digest gắn một dự án (OKR lọc theo dự án riêng, xem API). */
export const WORKSPACE_ONLY_DIGEST_BLOCKS: readonly DigestBlockId[] = ['workload'];

export interface DigestSection {
  id: string;
  title: string;
  /** Văn bản thuần, KHÔNG có HTML. */
  lines: string[];
}

export interface DigestModel {
  title: string;
  subtitle: string;
  sections: DigestSection[];
}

const isBlockId = (v: string): v is DigestBlockId => DIGEST_BLOCKS.some((b) => b.id === v);

/**
 * Chuẩn hoá `metrics` lưu trong DB: rỗng → khối của digest cũ; bỏ id lạ/trùng; luôn theo thứ tự chuẩn của
 * `DIGEST_BLOCKS` (thứ tự hiển thị không phụ thuộc thứ tự tick).
 */
export function resolveDigestBlocks(
  metrics: readonly string[] | null | undefined,
): DigestBlockId[] {
  const wanted = new Set((metrics ?? []).filter(isBlockId));
  if (wanted.size === 0) return [...LEGACY_DIGEST_BLOCKS];
  return DIGEST_BLOCKS.map((b) => b.id).filter((id) => wanted.has(id));
}
