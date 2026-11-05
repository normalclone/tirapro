import { z } from 'zod';

/** Trần số dòng mỗi lệnh (khớp BULK_MAX_ITEMS phía web). */
export const ASSISTANT_BULK_MAX_ROWS = 200;

const roleIds = z.array(z.string().min(1)).min(1, 'Cần ít nhất 1 vai trò').max(20);

export const assistantBulkAssignSchema = z.object({
  rows: z
    .array(
      z.object({
        issueId: z.string().min(1),
        version: z.number().int().nonnegative(),
        assigneeId: z.string().min(1).nullable(),
      }),
    )
    .min(1, 'Chưa có dòng nào để giao')
    .max(ASSISTANT_BULK_MAX_ROWS, `Mỗi lần tối đa ${ASSISTANT_BULK_MAX_ROWS} việc`),
});

export const assistantBulkMembersSchema = z.object({
  rows: z
    .array(
      z.object({
        projectId: z.string().min(1),
        userId: z.string().min(1),
        expect: roleIds.nullable(),
        set: roleIds.nullable(),
      }),
    )
    .min(1, 'Chưa có dòng nào để thực hiện')
    .max(ASSISTANT_BULK_MAX_ROWS, `Mỗi lần tối đa ${ASSISTANT_BULK_MAX_ROWS} dòng`),
});

export type AssistantBulkAssignBody = z.infer<typeof assistantBulkAssignSchema>;
export type AssistantBulkMembersBody = z.infer<typeof assistantBulkMembersSchema>;
