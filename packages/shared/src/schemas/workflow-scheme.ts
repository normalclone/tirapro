import { z } from 'zod';

/** Một dòng "Loại việc → Quy trình" của workspace. */
const schemeItemSchema = z.object({
  issueTypeId: z.string().min(1, 'Thiếu loại việc'),
  workflowId: z.string().min(1, 'Hãy chọn quy trình'),
});

/** Đặt cấu hình quy trình của workspace (PUT). Mỗi loại việc xuất hiện tối đa một lần. */
export const setWorkspaceSchemeSchema = z.object({
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
  statusMap: z.record(z.string().min(1), z.string().min(1)).default({}),
});
export type SetProjectOverrideInput = z.infer<typeof setProjectOverrideSchema>;
