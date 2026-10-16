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

/** `?section=digest` → mục tương ứng nếu đang hiện; giá trị lạ/mục bị ẩn → null (giữ mục mặc định). */
export function parseIntegrationSection(
  value: string | null,
  flags: { repos: boolean },
): IntegrationSectionId | null {
  return integrationSections(flags).find((s) => s.id === value)?.id ?? null;
}
