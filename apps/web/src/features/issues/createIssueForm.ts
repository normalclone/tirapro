export type CreateIssueField = 'project' | 'type' | 'summary';
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
}): CreateIssueFieldIssue[] {
  const issues: CreateIssueFieldIssue[] = [];
  if (!f.projectId) issues.push({ field: 'project', message: 'Chọn dự án cho công việc này.' });
  else if (f.metaReady && !f.typeId) issues.push({ field: 'type', message: 'Chọn loại việc.' });
  if (!f.summary.trim() || !f.cleanSummary.trim())
    issues.push({ field: 'summary', message: 'Hãy nhập tiêu đề mô tả việc cần làm' });
  return issues;
}
