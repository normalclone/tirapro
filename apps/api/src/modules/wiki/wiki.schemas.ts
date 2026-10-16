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
  /**
   * OCC: `version` của trang lúc người dùng mở sửa. Lệch (người khác đã lưu) → 409 VERSION_CONFLICT;
   * trang đã bị xoá → 404. Bỏ trống = ghi thẳng như trước (tương thích API key/client cũ).
   */
  expectedVersion: z.number().int().min(0).optional(),
});

/** Khôi phục một phiên bản cũ: OCC bắt buộc (`version` của trang người bấm đang xem). */
export const restoreWikiVersionSchema = z.object({
  expectedVersion: z.number().int().min(0),
});

/** Đổi cha / thứ tự trong danh sách anh em. `order` = vị trí chèn (0 = đầu). */
export const moveWikiPageSchema = z.object({
  parentId: z.string().min(1).optional().nullable(),
  order: z.number().int().min(0).max(10_000).optional(),
});

export type CreateWikiPageInput = z.infer<typeof createWikiPageSchema>;
export type UpdateWikiPageInput = z.infer<typeof updateWikiPageSchema>;
export type RestoreWikiVersionInput = z.infer<typeof restoreWikiVersionSchema>;
export type MoveWikiPageInput = z.infer<typeof moveWikiPageSchema>;
