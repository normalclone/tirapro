import { z } from 'zod';

/** NL → danh sách issue đề xuất (preview, KHÔNG tự persist). */
export const generateIssuesSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(3, 'Mô tả quá ngắn').max(10_000),
});

export type GenerateIssuesInput = z.infer<typeof generateIssuesSchema>;

/** Một issue do AI đề xuất (hoặc heuristic) — client review rồi mới tạo thật. */
export interface AiGeneratedIssue {
  summary: string;
  type?: string;
  description?: string;
  acceptanceCriteria?: string[];
  storyPoints?: number;
  priority?: string;
}

/**
 * Lý do AI không trả được kết quả nên rơi về heuristic: `timeout`/`error` = AI đã bật nhưng lời gọi hỏng;
 * `unconfigured` = AI chưa có khoá hoặc admin bật kill-switch (người dùng cuối không phân biệt được hai trường hợp).
 */
export type AiFallbackReason = 'timeout' | 'error' | 'unconfigured';

export interface AiGenerateIssuesResult {
  source: 'claude' | 'heuristic';
  /** Có khi `source = 'heuristic'` do Claude quá thời gian chờ / lỗi — client có thể gợi ý "thử lại". */
  reason?: AiFallbackReason;
  issues: AiGeneratedIssue[];
  /** Chỉ heuristic: tổng số mục tách được khi vượt số mục hiển thị (còn mục chưa trả về). */
  total?: number;
  /** Chỉ heuristic: phần văn bản của các mục chưa trả về — gửi lại làm đầu vào để phân tích tiếp. */
  remainingText?: string;
}

export interface AiSummaryResult {
  source: 'claude' | 'heuristic';
  reason?: AiFallbackReason;
  summary: string;
}

export interface AiSuggestResult {
  source: 'claude' | 'heuristic';
  reason?: AiFallbackReason;
  priority?: string;
  storyPoints?: number;
  assigneeHint?: string;
  rationale: string;
}

export interface AiCapabilities {
  available: boolean;
  mode: 'claude' | 'heuristic';
  model: string;
  features: string[];
}

/** Gợi ý người nhận việc: projectId để PermissionsGuard kiểm quyền; service kiểm issue thuộc dự án đó. */
export const suggestAssigneeSchema = z.object({
  projectId: z.string().min(1),
  issueId: z.string().min(1),
});
export type SuggestAssigneeInput = z.infer<typeof suggestAssigneeSchema>;

export interface AiAssigneeSuggestion {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** 0..1 — điểm heuristic (luôn tính từ số liệu thật, kể cả khi Claude xếp hạng lại). */
  score: number;
  reasons: string[];
}

export interface AiAssigneeSuggestResult {
  source: 'claude' | 'heuristic';
  reason?: AiFallbackReason;
  suggestions: AiAssigneeSuggestion[];
}

/** Trợ lý lập sprint: chọn issue từ backlog vào sprint theo năng lực (capacity). */
export const sprintPlanSchema = z.object({
  projectId: z.string().min(1),
  sprintId: z.string().min(1),
  capacityPoints: z.number().positive('Năng lực phải lớn hơn 0').max(10_000).optional(),
  goal: z.string().trim().max(500, 'Mục tiêu tối đa 500 ký tự').optional(),
});
export type SprintPlanInput = z.infer<typeof sprintPlanSchema>;

export interface AiSprintPick {
  issueId: string;
  key: string;
  summary: string;
  storyPoints: number;
  /** Phiên bản issue lúc lập kế hoạch — dùng cho bulk update (khoá lạc quan). */
  version: number;
  reason: string;
}

export interface AiSprintPlanResult {
  source: 'claude' | 'heuristic';
  reason?: AiFallbackReason;
  capacityPoints: number;
  /** Trung bình completedPoints của tối đa 3 sprint đã đóng gần nhất (0 nếu chưa có sprint nào). */
  velocityAvg: number;
  picks: AiSprintPick[];
  /** Số issue đã ước lượng nhưng không vừa năng lực nên chưa được chọn. */
  leftovers: number;
  /** Số issue chưa có story points nên bị bỏ qua — cần ước lượng trước. */
  unestimated: number;
}
