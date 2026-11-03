export type CreateIssueField = 'project' | 'type' | 'summary' | 'points' | 'due';

export const SUMMARY_MAX = 255;
export const POINTS_MAX = 100;
export interface CreateIssueFieldIssue {
  field: CreateIssueField;
  message: string;
}

/**
 * Lỗi của hộp "Tạo công việc" theo trường, ĐỦ mọi lỗi theo thứ tự trong form (quy tắc giữ nguyên: cần dự án, loại việc,
 * tiêu đề không rỗng kể cả sau khi lược token). `metaReady` = danh sách loại việc của dự án đã tải: chưa tải thì thiếu
 * loại chưa phải lỗi của người dùng. `cleanSummary` = tiêu đề đã lược token.
 */
export function validateCreateIssue(f: {
  projectId: string;
  metaReady: boolean;
  typeId: string;
  summary: string;
  cleanSummary: string;
  /** Chuỗi đang nhập ở ô Điểm ước lượng ('' = bỏ trống). */
  points?: string;
  /** Hạn đã chọn nằm trước hôm nay (theo ngày VN) → không được tạo (hạn không trước ngày tạo). */
  dueInPast?: boolean;
}): CreateIssueFieldIssue[] {
  const issues: CreateIssueFieldIssue[] = [];
  if (!f.projectId) issues.push({ field: 'project', message: 'Chọn dự án cho công việc này.' });
  else if (f.metaReady && !f.typeId) issues.push({ field: 'type', message: 'Chọn loại việc.' });
  if (!f.summary.trim() || !f.cleanSummary.trim())
    issues.push({ field: 'summary', message: 'Hãy nhập tiêu đề mô tả việc cần làm' });
  else if (f.cleanSummary.trim().length > SUMMARY_MAX)
    issues.push({
      field: 'summary',
      message: `Tiêu đề tối đa ${SUMMARY_MAX} ký tự (đang ${f.cleanSummary.trim().length}) — hãy rút gọn và đưa chi tiết vào phần mô tả.`,
    });
  if (f.points?.trim()) {
    const n = Number(f.points);
    if (!Number.isFinite(n) || n < 0)
      issues.push({ field: 'points', message: 'Điểm phải là số từ 0 trở lên' });
    else if (n > POINTS_MAX) issues.push({ field: 'points', message: `Điểm tối đa ${POINTS_MAX}` });
  }
  if (f.dueInPast)
    issues.push({
      field: 'due',
      message: 'Ngày hoàn thành không được trước ngày tạo — hãy chọn ngày từ hôm nay trở đi.',
    });
  return issues;
}
