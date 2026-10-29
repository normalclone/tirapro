import type { KeyResultSource } from '@tirapro/types';

/** Cấu hình nguồn số liệu như BE lưu (`sourceConfig`): `{}` | `{ projectId }` | `{ jql }`. */
export type KrSourceConfig = { projectId?: string; jql?: string } | null;

export interface KrSourceFields {
  source: KeyResultSource;
  sourceConfig: KrSourceConfig;
}

export const SOURCE_OPTIONS: { value: KeyResultSource; label: string }[] = [
  { value: 'MANUAL', label: 'Nhập tay' },
  { value: 'OPEN_BUGS', label: 'Số bug đang mở' },
  { value: 'SPRINT_COMPLETION', label: '% điểm hoàn tất của sprint' },
  { value: 'ISSUE_COUNT_JQL', label: 'Số công việc theo JQL' },
];

export const MAX_JQL_LENGTH = 500;

/** KR lấy số từ dữ liệu (không gõ tay). */
export function isAutoSource(source: KeyResultSource): boolean {
  return source !== 'MANUAL';
}

/** Khung cấu hình rỗng khi người dùng chọn một nguồn trong form. */
export function defaultConfig(source: KeyResultSource): KrSourceConfig {
  switch (source) {
    case 'OPEN_BUGS':
      return {};
    case 'SPRINT_COMPLETION':
      return { projectId: '' };
    case 'ISSUE_COUNT_JQL':
      return { jql: '' };
    default:
      return null;
  }
}

/** Đủ cấu hình để lưu chưa (BE vẫn kiểm lại: dự án thuộc workspace, JQL hợp lệ). */
export function isSourceConfigComplete(source: KeyResultSource, config: KrSourceConfig): boolean {
  if (source === 'SPRINT_COMPLETION') return !!config?.projectId;
  if (source === 'ISSUE_COUNT_JQL') {
    const jql = (config?.jql ?? '').trim();
    return jql.length > 0 && jql.length <= MAX_JQL_LENGTH;
  }
  return true;
}

/** Câu giải thích nguồn số liệu (tooltip của huy hiệu "Tự đo"); `projectNames`: id → tên dự án. */
export function describeSource(
  kr: KrSourceFields,
  projectNames: Record<string, string> = {},
): string {
  // `sourceConfig = null` ở KR tự đo: BE che cấu hình (dự án riêng tư / JQL cần quyền) → chỉ nêu loại nguồn.
  const project = kr.sourceConfig?.projectId
    ? (projectNames[kr.sourceConfig.projectId] ?? 'đã chọn')
    : null;
  switch (kr.source) {
    case 'OPEN_BUGS':
      if (!kr.sourceConfig) return 'Số bug đang mở của một dự án (chi tiết bị ẩn với bạn)';
      return project
        ? `Số bug đang mở của dự án ${project}`
        : 'Số bug đang mở trong mọi dự án bạn có quyền xem';
    case 'SPRINT_COMPLETION':
      return project
        ? `% điểm hoàn tất của sprint hiện tại (hoặc vừa đóng) — dự án ${project}`
        : '% điểm hoàn tất của sprint hiện tại (hoặc vừa đóng) của một dự án (chi tiết bị ẩn với bạn)';
    case 'ISSUE_COUNT_JQL':
      return kr.sourceConfig?.jql
        ? `Số công việc khớp JQL: ${kr.sourceConfig.jql} (trong dự án bạn có quyền xem)`
        : 'Số công việc khớp một câu JQL (chi tiết bị ẩn với bạn)';
    default:
      return 'Nhập tay';
  }
}
