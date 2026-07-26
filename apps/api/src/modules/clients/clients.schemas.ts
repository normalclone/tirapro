import { z } from 'zod';

/** Ngày: 'YYYY-MM-DD' (input type=date) hoặc ISO-8601; chuỗi rỗng = bỏ trống. */
const dateInput = z
  .string()
  .trim()
  .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Ngày không hợp lệ')
  .nullable()
  .optional();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'Tên khách hàng bắt buộc').max(160),
  contactName: optionalText(120),
  email: z.string().trim().max(160).email('Email không hợp lệ').or(z.literal('')).nullable().optional(),
  phone: optionalText(40),
  note: optionalText(1000),
  projectIds: z.array(z.string().min(1)).max(500).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const setClientProjectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(500),
});

export const createContractSchema = z.object({
  name: z.string().trim().min(1, 'Tên hợp đồng bắt buộc').max(160),
  code: optionalText(60),
  value: z.number().min(0, 'Giá trị không được âm').max(1e15).nullable().optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  projectId: z.string().nullable().optional(),
  startDate: dateInput,
  endDate: dateInput,
  note: optionalText(1000),
});

export const updateContractSchema = createContractSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type SetClientProjectsInput = z.infer<typeof setClientProjectsSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
