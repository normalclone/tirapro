/** Khoá từng mục cấu hình dự án = đoạn cuối của route `/p/:key/config/:section`. */
export const CONFIG_SECTION_IDS = [
  'general',
  'members',
  'components',
  'versions',
  'labels',
  'data',
] as const;

export type ConfigSectionId = (typeof CONFIG_SECTION_IDS)[number];

export function isConfigSection(value: string | null | undefined): value is ConfigSectionId {
  return (CONFIG_SECTION_IDS as readonly string[]).includes(value ?? '');
}

export function configSectionPath(projectKey: string, id: ConfigSectionId): string {
  return `/p/${projectKey}/config/${id}`;
}

/**
 * Đích của `/p/:key/config` (kể cả liên kết kiểu `?section=members`): mục hợp lệ → route con của nó, còn lại → Chung.
 * Các query khác được giữ, riêng `section` bị bỏ. Thuần để test.
 */
export function configRedirectTarget(projectKey: string, search: string): string {
  const params = new URLSearchParams(search);
  const section = params.get('section');
  const id: ConfigSectionId = isConfigSection(section) ? section : 'general';
  params.delete('section');
  const rest = params.toString();
  return `${configSectionPath(projectKey, id)}${rest ? `?${rest}` : ''}`;
}
