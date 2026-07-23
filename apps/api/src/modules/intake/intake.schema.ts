import { z } from 'zod';

/** Body cho POST /intake/report — báo cáo một issue/bug. */
export const reportIssueSchema = z.object({
  projectId: z.string().min(1),
  summary: z.string().min(3, 'Tiêu đề tối thiểu 3 ký tự').max(255),
  description: z.string().max(50_000).optional().nullable(),
  typeId: z.string().min(1).optional(),
});

export type ReportIssueInput = z.infer<typeof reportIssueSchema>;
