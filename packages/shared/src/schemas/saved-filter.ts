import { z } from 'zod';
import { FilterVisibility } from '@tirapro/types';

/**
 * Bộ lọc đã lưu. Chia sẻ = `visibility: SHARED` kèm danh sách dự án (thành viên dự án thấy) và/hoặc người cụ thể; `PRIVATE`
 * = chỉ chủ. `SHARED` mà không có đích nào là vô nghĩa (không ai thấy ngoài chủ) nên bị chặn (422).
 */
export const SHARE_TARGET_REQUIRED_MESSAGE = 'Chọn ít nhất một dự án hoặc một người để chia sẻ';
/** Trần số đích chia sẻ một bộ lọc (chặn thân yêu cầu khổng lồ). */
export const MAX_SHARED_PROJECTS = 50;
export const MAX_SHARED_USERS = 200;

const visibilitySchema = z.nativeEnum(FilterVisibility);
const idList = (max: number) =>
  z
    .array(z.string().min(1))
    .max(max)
    .transform((a) => [...new Set(a)]);

const shareFields = {
  visibility: visibilitySchema.optional(),
  sharedProjectIds: idList(MAX_SHARED_PROJECTS).optional(),
  sharedUserIds: idList(MAX_SHARED_USERS).optional(),
};

/** `true` = vi phạm: mức SHARED tường minh mà không có đích nào (trên chính thân yêu cầu). */
const sharedWithoutTarget = (v: {
  visibility?: string;
  sharedProjectIds?: string[];
  sharedUserIds?: string[];
}) =>
  v.visibility === FilterVisibility.SHARED &&
  (v.sharedProjectIds?.length ?? 0) + (v.sharedUserIds?.length ?? 0) === 0;
const refineOpts = { message: SHARE_TARGET_REQUIRED_MESSAGE, path: ['sharedProjectIds'] };

export const savedFilterCreateSchema = z
  .object({
    name: z.string().min(1, 'Tên bắt buộc').max(120),
    jql: z.string().min(1, 'JQL bắt buộc').max(10_000),
    ...shareFields,
  })
  .refine((v) => !sharedWithoutTarget(v), refineOpts);

export const savedFilterUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    jql: z.string().min(1).max(10_000).optional(),
    ...shareFields,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để cập nhật' })
  .refine((v) => !sharedWithoutTarget(v), refineOpts);

/** `POST /filters/audience`: đếm "ai xem được" cho một bản chia sẻ CHƯA lưu (hộp Chia sẻ tính trực tiếp khi đang chọn). */
export const filterAudienceSchema = z.object({
  sharedProjectIds: idList(MAX_SHARED_PROJECTS).default([]),
  sharedUserIds: idList(MAX_SHARED_USERS).default([]),
});
export type FilterAudienceInput = z.infer<typeof filterAudienceSchema>;

export type SavedFilterCreateInput = z.infer<typeof savedFilterCreateSchema>;
export type SavedFilterUpdateInput = z.infer<typeof savedFilterUpdateSchema>;

export interface FilterShareState {
  visibility: FilterVisibility;
  sharedProjectIds: string[];
  sharedUserIds: string[];
}

/**
 * Trạng thái chia sẻ SAU khi áp `input` lên `current` (`null` = tạo mới). Một nơi quyết định cho dịch vụ:
 * - `visibility` tường minh thắng; không nói mà có gửi danh sách → SHARED nếu còn đích, ngược lại PRIVATE; không gửi gì → giữ.
 * - PRIVATE luôn xoá hết đích. SHARED mà không còn đích nào → `error` (tiếng Việt, dịch vụ ném 422).
 * - Danh sách không gửi thì giữ nguyên danh sách hiện có (gửi `[]` là xoá).
 */
export function resolveFilterShare(
  current: FilterShareState | null,
  input: { visibility?: FilterVisibility; sharedProjectIds?: string[]; sharedUserIds?: string[] },
): { value: FilterShareState; error: null } | { value: null; error: string } {
  const projects = input.sharedProjectIds ?? current?.sharedProjectIds ?? [];
  const users = input.sharedUserIds ?? current?.sharedUserIds ?? [];
  const touchedLists = input.sharedProjectIds !== undefined || input.sharedUserIds !== undefined;
  const visibility =
    input.visibility ??
    (touchedLists
      ? projects.length + users.length > 0
        ? FilterVisibility.SHARED
        : FilterVisibility.PRIVATE
      : (current?.visibility ?? FilterVisibility.PRIVATE));
  if (visibility === FilterVisibility.PRIVATE) {
    return { value: { visibility, sharedProjectIds: [], sharedUserIds: [] }, error: null };
  }
  if (projects.length + users.length === 0)
    return { value: null, error: SHARE_TARGET_REQUIRED_MESSAGE };
  return {
    value: {
      visibility,
      sharedProjectIds: [...new Set(projects)],
      sharedUserIds: [...new Set(users)],
    },
    error: null,
  };
}
