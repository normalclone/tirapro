import { z } from 'zod';

/** Người tham gia issue (ngoài assignee/reporter). */
export const setParticipantsSchema = z.object({
  userIds: z.array(z.string().min(1)).max(50),
});

export const addChecklistSchema = z.object({
  text: z.string().min(1, 'Nội dung bắt buộc').max(500),
});

export const updateChecklistSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export type SetParticipantsInput = z.infer<typeof setParticipantsSchema>;
export type AddChecklistInput = z.infer<typeof addChecklistSchema>;
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;
