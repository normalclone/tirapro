import { z } from 'zod';
import { parseDuration } from '../duration';

/** Chuỗi thời gian kiểu Jira ("2h 30m", "90m", "1d"); phải đọc được và > 0. */
export const durationStringSchema = z
  .string()
  .trim()
  .min(1, 'Hãy nhập thời gian, ví dụ 2h 30m')
  .max(40)
  .refine((s) => {
    const sec = parseDuration(s);
    return sec !== null && sec > 0;
  }, 'Thời gian không hợp lệ — hãy nhập dạng 2h 30m, 90m hoặc 1d (1d = 8 giờ)');

/**
 * Cách cập nhật ước lượng còn lại khi ghi/sửa/xoá worklog:
 * - `auto` (mặc định): còn lại = max(0, ước lượng gốc − tổng đã làm); không có ước lượng gốc thì giữ nguyên.
 * - `leave`: giữ nguyên.
 * - `{ set }`: đặt đúng giá trị này (chuỗi thời gian).
 */
export const adjustRemainingSchema = z.union([
  z.enum(['auto', 'leave']),
  z.object({ set: z.string().trim().min(1).max(40).refine((s) => parseDuration(s) !== null, 'Thời gian còn lại không hợp lệ') }),
]);

export const createWorklogSchema = z.object({
  timeSpent: durationStringSchema,
  startedAt: z.string().datetime().optional(),
  comment: z.string().max(5000).optional().nullable(),
  adjustRemaining: adjustRemainingSchema.optional(),
});

export const updateWorklogSchema = z
  .object({
    timeSpent: durationStringSchema.optional(),
    startedAt: z.string().datetime().optional(),
    comment: z.string().max(5000).optional().nullable(),
    adjustRemaining: adjustRemainingSchema.optional(),
  })
  .refine((v) => v.timeSpent !== undefined || v.startedAt !== undefined || v.comment !== undefined, 'Hãy sửa ít nhất một trường');

export const deleteWorklogQuerySchema = z.object({
  adjustRemaining: z.enum(['auto', 'leave']).optional(),
});

export type AdjustRemainingInput = z.infer<typeof adjustRemainingSchema>;
export type CreateWorklogInput = z.infer<typeof createWorklogSchema>;
export type UpdateWorklogInput = z.infer<typeof updateWorklogSchema>;
