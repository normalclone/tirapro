import { z } from 'zod';
import { SWIMLANE_BY } from '@tirapro/types';

/** Sửa thông tin board. `filterJql` rỗng/null = bỏ bộ lọc. */
export const updateBoardSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Tên bảng không được để trống')
      .max(120, 'Tên bảng tối đa 120 ký tự')
      .optional(),
    filterJql: z.string().max(5_000, 'Bộ lọc JQL quá dài').nullable().optional(),
    swimlaneBy: z.enum(SWIMLANE_BY).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy chọn ít nhất một thay đổi');

/**
 * Thay toàn bộ cột của board. Thứ tự mảng = thứ tự cột. Mỗi cột cần ít nhất một trạng thái;
 * việc "mọi trạng thái của workflow xuất hiện đúng một lần" do service kiểm vì cần đọc workflow.
 */
export const setBoardColumnsSchema = z.object({
  columns: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        name: z
          .string()
          .trim()
          .min(1, 'Tên cột không được để trống')
          .max(60, 'Tên cột tối đa 60 ký tự'),
        statusIds: z.array(z.string().min(1)).min(1, 'Mỗi cột cần ít nhất một trạng thái'),
        wipLimit: z
          .number()
          .int('Giới hạn WIP phải là số nguyên')
          .min(1, 'Giới hạn WIP tối thiểu là 1')
          .max(999)
          .nullable()
          .optional(),
      }),
    )
    .min(1, 'Bảng cần ít nhất một cột')
    .max(30, 'Bảng tối đa 30 cột'),
});

export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type SetBoardColumnsInput = z.infer<typeof setBoardColumnsSchema>;
