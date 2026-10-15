import { z } from 'zod';

const t = (max: number) => z.string().trim().max(max).optional();

/** Môi trường phát sinh lỗi (trình duyệt/OS/build/URL…) — lưu JSONB một cột trên Issue. */
export const environmentSchema = z
  .object({
    env: z.enum(['production', 'staging', 'dev', 'other']).optional(),
    browser: t(120),
    os: t(120),
    build: t(120),
    viewport: t(20),
    url: z
      .string()
      .trim()
      .max(500)
      .regex(/^https?:\/\//i, 'URL phải bắt đầu bằng http:// hoặc https://')
      .optional(),
  })
  .strict();
export type EnvironmentInput = z.infer<typeof environmentSchema>;

/** Bỏ khoá rỗng + trim; trả `null` khi không còn khoá nào (tránh lưu `{}`). */
export function normalizeEnvironment(
  e: EnvironmentInput | null | undefined,
): EnvironmentInput | null {
  if (!e) return null;
  const out = Object.fromEntries(
    Object.entries(e)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v] as const)
      .filter(([, v]) => v),
  ) as EnvironmentInput;
  return Object.keys(out).length ? out : null;
}

/** Một dòng: `production · Chrome 126 · macOS 14 · build 2.3.1 · 1440×900 · https://…` (bỏ phần trống). */
export function formatEnvironment(e: EnvironmentInput | null | undefined): string {
  if (!e) return '';
  return [e.env, e.browser, e.os, e.build ? `build ${e.build}` : '', e.viewport, e.url]
    .filter(Boolean)
    .join(' · ');
}
