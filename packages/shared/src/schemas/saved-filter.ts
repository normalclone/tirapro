import { z } from 'zod';
import { FilterVisibility } from '@tirapro/types';

/**
 * Bộ lọc đã lưu. Mức `PROJECT` PHẢI kèm dự án: máy chủ xử lý `PROJECT` + `sharedProjectId = null` như "cả không gian thấy"
 * (`visibilityScope`) — người tạo tưởng chỉ dự án thấy trong khi tên và JQL lộ cho mọi người. Các bộ lọc CŨ đang ở trạng thái
 * đó vẫn đọc được (hiển thị đúng là "Cả không gian"); luật chỉ chặn tạo/sửa mới.
 */
export const SHARED_PROJECT_REQUIRED_MESSAGE = 'Chia sẻ theo dự án phải chọn một dự án';

const visibilitySchema = z.nativeEnum(FilterVisibility);

/** `true` = vi phạm: mức PROJECT mà không có dự án (thiếu / null / rỗng). */
const projectWithoutProject = (v: { visibility?: string; sharedProjectId?: string | null }) =>
  v.visibility === FilterVisibility.PROJECT && !v.sharedProjectId;
const refineOpts = { message: SHARED_PROJECT_REQUIRED_MESSAGE, path: ['sharedProjectId'] };

export const savedFilterCreateSchema = z
  .object({
    name: z.string().min(1, 'Tên bắt buộc').max(120),
    jql: z.string().min(1, 'JQL bắt buộc').max(10_000),
    visibility: visibilitySchema.optional(),
    sharedProjectId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => !projectWithoutProject(v), refineOpts);

export const savedFilterUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    jql: z.string().min(1).max(10_000).optional(),
    visibility: visibilitySchema.optional(),
    sharedProjectId: z.string().min(1).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật' })
  .refine((v) => !projectWithoutProject(v), refineOpts);

export type SavedFilterCreateInput = z.infer<typeof savedFilterCreateSchema>;
export type SavedFilterUpdateInput = z.infer<typeof savedFilterUpdateSchema>;

/**
 * Chốt chặn ở dịch vụ: trạng thái chia sẻ SAU khi áp `input` lên `current` (`null` = tạo mới). Chỉ xét khi `input` đụng tới
 * `visibility`/`sharedProjectId` — nhờ vậy bộ lọc cũ `PROJECT` + null vẫn đổi tên/JQL được, và vẫn rời được sang mức khác.
 * Trả câu lỗi tiếng Việt hoặc `null`.
 */
export function effectiveFilterShareError(
  current: { visibility: string; sharedProjectId: string | null } | null,
  input: { visibility?: string; sharedProjectId?: string | null; [other: string]: unknown },
): string | null {
  if (input.visibility === undefined && input.sharedProjectId === undefined && current) return null;
  const visibility = input.visibility ?? current?.visibility ?? FilterVisibility.PRIVATE;
  const sharedProjectId =
    input.sharedProjectId !== undefined
      ? input.sharedProjectId
      : (current?.sharedProjectId ?? null);
  return projectWithoutProject({ visibility, sharedProjectId })
    ? SHARED_PROJECT_REQUIRED_MESSAGE
    : null;
}
