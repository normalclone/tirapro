import { z } from 'zod';
import { environmentSchema } from '@tirapro/shared';

/** Loại yêu cầu của form "Báo lỗi / Gửi yêu cầu": Bug, Yêu cầu tính năng, Câu hỏi. */
export const REQUEST_KINDS = ['BUG', 'FEATURE', 'QUESTION'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Body cho POST /intake/report — báo cáo một issue/bug hoặc gửi yêu cầu. */
export const reportIssueSchema = z
  .object({
    projectId: z.string().min(1),
    summary: z.string().trim().min(3, 'Tiêu đề tối thiểu 3 ký tự').max(255),
    description: z.string().max(50_000).optional().nullable(),
    kind: z.enum(REQUEST_KINDS).default('BUG'),
    typeId: z.string().min(1).optional(),
    severityId: z.string().min(1).optional().nullable(),
    environment: environmentSchema.optional().nullable(),
    /** Người dùng chọn "Thêm ghi chú vào bug cũ": nội dung mới thành bình luận trên bug này. */
    mergeIntoIssueId: z.string().min(1).optional(),
    /** "Vẫn tạo mới": bỏ qua cả gộp có chọn lẫn gộp tự động theo tiêu đề giống hệt. */
    forceNew: z.boolean().optional(),
    /** Tệp đã tải lên bug đích (route comment-attachments) — chỉ có nghĩa khi gộp. */
    attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  })
  .refine((v) => !(v.mergeIntoIssueId && v.forceNew), {
    message: 'Không thể vừa gộp vừa tạo mới',
  });

export type ReportIssueInput = z.infer<typeof reportIssueSchema>;
