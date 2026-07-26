import { z } from 'zod';

/** Tạo trang wiki. `projectId` null = tài liệu chung của workspace. */
export const createWikiPageSchema = z.object({
  title: z.string().min(1, 'Tiêu đề bắt buộc').max(200),
  body: z.string().max(200_000).optional().default(''),
  projectId: z.string().min(1).optional().nullable(),
  parentId: z.string().min(1).optional().nullable(),
});

export const updateWikiPageSchema = z.object({
  title: z.string().min(1, 'Tiêu đề bắt buộc').max(200).optional(),
  body: z.string().max(200_000).optional(),
});

/** Đổi cha / thứ tự trong danh sách anh em. `order` = vị trí chèn (0 = đầu). */
export const moveWikiPageSchema = z.object({
  parentId: z.string().min(1).optional().nullable(),
  order: z.number().int().min(0).max(10_000).optional(),
});

export type CreateWikiPageInput = z.infer<typeof createWikiPageSchema>;
export type UpdateWikiPageInput = z.infer<typeof updateWikiPageSchema>;
export type MoveWikiPageInput = z.infer<typeof moveWikiPageSchema>;
