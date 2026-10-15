export type IntegrationSectionId = 'telegram' | 'repos' | 'digest';

/** Mục của trang Tích hợp theo cờ tính năng (hàm thuần để test). `repos` = Kho mã (GitHub/GitLab). */
export function integrationSections(flags: { repos: boolean }): {
  id: IntegrationSectionId;
  label: string;
}[] {
  return [
    { id: 'telegram', label: 'Telegram' },
    ...(flags.repos ? [{ id: 'repos' as const, label: 'Kho mã' }] : []),
    { id: 'digest', label: 'Digest' },
  ];
}
