import { z } from 'zod';

const dayString = z
  .string()
  .trim()
  .min(8, 'Ngày không hợp lệ')
  .refine((v) => !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00.000Z` : v)), 'Ngày không hợp lệ');

/** Trần một lần ghi công: 24 giờ. */
const MAX_SECONDS = 24 * 3600;

export const timesheetQuerySchema = z.object({
  from: dayString.optional(),
  to: dayString.optional(),
  /** Bỏ trống = chính người gọi. Xem của người khác cần quyền `resource:manage`. */
  userId: z.string().optional(),
  projectId: z.string().optional(),
});

export const logTimeSchema = z.object({
  issueId: z.string().min(1, 'Chọn công việc'),
  startedAt: dayString,
  timeSpent: z.number().int('Thời gian phải là số nguyên giây').min(60, 'Tối thiểu 1 phút').max(MAX_SECONDS, 'Tối đa 24 giờ một lần ghi'),
  comment: z.string().max(1000).optional().nullable(),
  /** Ghi công hộ người khác — cần quyền `resource:manage`. */
  userId: z.string().optional().nullable(),
});

/** Đặt TỔNG giờ của một ô (issue × ngày) — dùng cho lưới nhập nhanh. */
export const setCellSchema = z.object({
  issueId: z.string().min(1, 'Chọn công việc'),
  date: dayString,
  timeSpent: z.number().int('Thời gian phải là số nguyên giây').min(0).max(MAX_SECONDS, 'Tối đa 24 giờ một ngày'),
  comment: z.string().max(1000).optional().nullable(),
  userId: z.string().optional().nullable(),
});

export const issueSearchQuerySchema = z.object({
  q: z.string().max(120).optional(),
  projectId: z.string().optional(),
});

export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>;
export type LogTimeInput = z.infer<typeof logTimeSchema>;
export type SetCellInput = z.infer<typeof setCellSchema>;
export type IssueSearchQuery = z.infer<typeof issueSearchQuerySchema>;
