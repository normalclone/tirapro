export type IntegrationSectionId = 'telegram' | 'repos' | 'digest';

/** Mục của trang Tích hợp theo cờ tính năng (hàm thuần để test). `repos` = Kho mã (GitHub/GitLab). */
export function integrationSections(flags: { repos: boolean }): {
  id: IntegrationSectionId;
  label: string;
}[] {
  return [
    { id: 'telegram', label: 'Telegram' },
    ...(flags.repos ? [{ id: 'repos' as const, label: 'Kho mã' }] : []),
    { id: 'digest', label: 'Báo cáo định kỳ' },
  ];
}

/** Đường dẫn route con của một mục: `/connect/integrations/<id>`. */
export function integrationPath(id: IntegrationSectionId): string {
  return `/connect/integrations/${id}`;
}

/** Hàng tab theo route (`to` tuyệt đối). */
export function integrationTabs(flags: { repos: boolean }): { to: string; label: string }[] {
  return integrationSections(flags).map((s) => ({ to: integrationPath(s.id), label: s.label }));
}

/** `digest` / `/connect/integrations/digest` → mục tương ứng nếu đang hiện; giá trị lạ/mục bị ẩn → null. */
export function parseIntegrationSection(
  value: string | null | undefined,
  flags: { repos: boolean },
): IntegrationSectionId | null {
  return integrationSections(flags).find((s) => s.id === value)?.id ?? null;
}

/**
 * Đích của `/connect/integrations` (kể cả liên kết cũ `?section=digest`): mục hợp lệ → route con của nó, còn lại →
 * Telegram. Các query khác (vd `?project=<id>` của Kết nối) được giữ, riêng `section` bị bỏ. Thuần để test.
 */
export function integrationRedirectTarget(search: string, flags: { repos: boolean }): string {
  const params = new URLSearchParams(search);
  const id = parseIntegrationSection(params.get('section'), flags) ?? 'telegram';
  params.delete('section');
  const rest = params.toString();
  return `${integrationPath(id)}${rest ? `?${rest}` : ''}`;
}
