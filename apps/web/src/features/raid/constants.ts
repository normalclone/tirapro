import type { RaidKind, RaidLevel, RaidStatus } from './api';

/** Bốn loại mục theo dõi (quốc tế gọi là RAID) — nhãn tiếng Việt dùng chung cho tab, bảng và modal. */
export const RAID_KINDS: { value: RaidKind; label: string; description: string }[] = [
  { value: 'RISK', label: 'Rủi ro', description: 'Điều chưa xảy ra nhưng có thể xảy ra và gây hại — ghi lại để phòng trước.' },
  { value: 'ASSUMPTION', label: 'Giả định', description: 'Điều bạn đang tin là đúng mà chưa kiểm chứng — nếu sai thì kế hoạch lệch.' },
  { value: 'ISSUE', label: 'Vấn đề', description: 'Điều đang xảy ra và đang cản trở công việc — cần xử lý ngay.' },
  { value: 'DEPENDENCY', label: 'Phụ thuộc', description: 'Việc phải chờ bên khác làm xong — bên đó trễ thì mình trễ theo.' },
];

export const RAID_KIND_LABEL: Record<RaidKind, string> = {
  RISK: 'Rủi ro',
  ASSUMPTION: 'Giả định',
  ISSUE: 'Vấn đề',
  DEPENDENCY: 'Phụ thuộc',
};

export const RAID_STATUS_META: Record<RaidStatus, { label: string; className: string; hint: string }> = {
  OPEN: { label: 'Chưa xử lý', className: 'bg-warning/12 text-warning', hint: 'Đã ghi nhận nhưng chưa ai bắt tay vào làm gì' },
  MITIGATING: { label: 'Đang xử lý', className: 'bg-primary-subtle text-primary', hint: 'Đang làm để giảm xác suất hoặc giảm thiệt hại' },
  CLOSED: { label: 'Đã xong', className: 'bg-success/12 text-success', hint: 'Đã xử lý xong hoặc không còn đáng lo nữa' },
  ACCEPTED: { label: 'Chấp nhận', className: 'bg-surface-2 text-muted', hint: 'Cả nhóm quyết định sống chung, không tốn công xử lý' },
};

export const RAID_STATUS_OPTIONS: { value: RaidStatus; label: string }[] = [
  { value: 'OPEN', label: 'Chưa xử lý' },
  { value: 'MITIGATING', label: 'Đang xử lý' },
  { value: 'CLOSED', label: 'Đã xong' },
  { value: 'ACCEPTED', label: 'Chấp nhận, không xử lý' },
];

/**
 * Mức rủi ro theo điểm (xác suất × ảnh hưởng): Thấp 1–6, Trung bình 7–12,
 * Cao 13–19, Nghiêm trọng 20–25. Màu bám token, không dùng màu tự chế.
 */
export const RAID_LEVEL_META: Record<RaidLevel, { label: string; badge: string; cell: string }> = {
  LOW: { label: 'Thấp', badge: 'bg-success/12 text-success', cell: 'bg-success/10 text-success' },
  MEDIUM: { label: 'Trung bình', badge: 'bg-warning/12 text-warning', cell: 'bg-warning/12 text-warning' },
  HIGH: { label: 'Cao', badge: 'bg-danger/12 text-danger', cell: 'bg-danger/18 text-danger' },
  CRITICAL: { label: 'Nghiêm trọng', badge: 'bg-danger text-white', cell: 'bg-danger text-white' },
};

/** Giải nghĩa thang điểm cho tooltip — người mới không phải đoán con số nghĩa là gì. */
export const RAID_LEVEL_LEGEND =
  'Điểm rủi ro = xác suất × mức ảnh hưởng (1–25). Thấp 1–6 · Trung bình 7–12 · Cao 13–19 · Nghiêm trọng 20–25.';

export function raidLevelOf(score: number): RaidLevel {
  if (score >= 20) return 'CRITICAL';
  if (score >= 13) return 'HIGH';
  if (score >= 7) return 'MEDIUM';
  return 'LOW';
}

/** Nhãn 1..5 cho xác suất và mức ảnh hưởng — nói bằng lời, không bắt người dùng đoán con số. */
export const PROBABILITY_LABELS: Record<number, string> = {
  1: 'Rất khó xảy ra',
  2: 'Khó xảy ra',
  3: 'Có thể xảy ra',
  4: 'Dễ xảy ra',
  5: 'Gần như chắc chắn',
};

export const IMPACT_LABELS: Record<number, string> = {
  1: 'Không đáng kể',
  2: 'Nhẹ',
  3: 'Trung bình',
  4: 'Nặng',
  5: 'Nghiêm trọng',
};

export const SCALE = [1, 2, 3, 4, 5] as const;
