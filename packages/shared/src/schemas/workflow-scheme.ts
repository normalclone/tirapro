import { z } from 'zod';

/** Một dòng "Loại việc → Quy trình" của workspace. */
const schemeItemSchema = z.object({
  issueTypeId: z.string().min(1, 'Thiếu loại việc'),
  workflowId: z.string().min(1, 'Hãy chọn quy trình'),
});

/** Trạng thái cũ → trạng thái mới (id), cho việc đang ở quy trình bị bỏ. */
const statusMapSchema = z.record(z.string().min(1), z.string().min(1));

/**
 * Đặt cấu hình quy trình của workspace (PUT). Mỗi loại việc xuất hiện tối đa một lần.
 * `statusMap` (phẳng) áp cho mọi loại; `statusMapByType[loại]` ghi đè cho loại đó (cần khi hai loại cùng rời một trạng thái
 * cũ nhưng sang hai quy trình khác nhau).
 */
export const setWorkspaceSchemeSchema = z.object({
  statusMap: statusMapSchema.optional(),
  statusMapByType: z.record(z.string().min(1), statusMapSchema).optional(),
  items: z
    .array(schemeItemSchema)
    .min(1, 'Hãy chọn ít nhất một loại việc')
    .max(100)
    .refine(
      (items) => new Set(items.map((i) => i.issueTypeId)).size === items.length,
      'Mỗi loại việc chỉ được chọn một quy trình',
    ),
});
export type SetWorkspaceSchemeInput = z.infer<typeof setWorkspaceSchemeSchema>;

/**
 * Ghi đè quy trình của một dự án cho một loại việc.
 * `workflowId: null` = quay về dùng chung với workspace.
 * `statusMap` = trạng thái cũ → trạng thái mới, để chuyển các việc đang ở quy trình bị bỏ.
 */
export const setProjectOverrideSchema = z.object({
  issueTypeId: z.string().min(1, 'Thiếu loại việc'),
  workflowId: z.string().min(1).nullable(),
  statusMap: statusMapSchema.default({}),
  /** true = chép quy trình của tổ chức thành bản riêng của dự án (để sửa) thay vì dùng thẳng. */
  copy: z.boolean().optional(),
});
export type SetProjectOverrideInput = z.infer<typeof setProjectOverrideSchema>;
