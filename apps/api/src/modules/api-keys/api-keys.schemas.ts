import { z } from 'zod';

/** Tạo API key: tên + có cho phép ghi hay không (mặc định chỉ đọc). */
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Cần tên khoá').max(80),
  write: z.boolean().default(false),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
