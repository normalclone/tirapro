import type { ActivityItem } from './api';

/** Chip lọc của tab Lịch sử. `fields` = giá trị `HistoryField` gửi lên `GET /issues/:id/activity?fields=`; rỗng = tất cả. */
export const ACTIVITY_FILTERS: { id: string; label: string; fields: string[] }[] = [
  { id: 'all', label: 'Tất cả', fields: [] },
  { id: 'status', label: 'Trạng thái', fields: ['STATUS'] },
  { id: 'points', label: 'Điểm', fields: ['STORY_POINTS'] },
  { id: 'assignee', label: 'Người phụ trách', fields: ['ASSIGNEE'] },
  { id: 'priority', label: 'Ưu tiên', fields: ['PRIORITY'] },
  { id: 'sprint', label: 'Sprint', fields: ['SPRINT'] },
  { id: 'description', label: 'Mô tả', fields: ['DESCRIPTION'] },
  { id: 'other', label: 'Khác', fields: ['TYPE', 'RESOLUTION', 'SCOPE', 'TIME_SPENT'] },
];

/** CSV cho `?fields=`; `undefined` cho "Tất cả" hoặc id lạ. */
export function fieldsParam(filterId: string): string | undefined {
  const f = ACTIVITY_FILTERS.find((x) => x.id === filterId);
  return f && f.fields.length ? f.fields.join(',') : undefined;
}

/** Giá trị hiển thị, rỗng → dấu gạch. */
const val = (v: string | null): string => (v != null && v !== '' ? v : '—');

/** Mô tả tiếng Việt cho một thay đổi (người/sprint dùng nhãn đã phân giải ở máy chủ). */
export function describeActivity(a: ActivityItem): string {
  switch (a.field) {
    case 'STATUS':
      return a.oldValue
        ? `đổi trạng thái: ${a.oldValue} → ${val(a.newValue)}`
        : `đổi trạng thái: → ${val(a.newValue)}`;
    case 'ASSIGNEE':
      return `đổi người phụ trách: ${a.oldLabel ?? 'Chưa gán'} → ${a.newLabel ?? 'Chưa gán'}`;
    case 'PRIORITY':
      return `đổi ưu tiên: ${val(a.oldValue)} → ${val(a.newValue)}`;
    case 'STORY_POINTS':
      return `đổi điểm: ${val(a.oldValue)} → ${val(a.newValue)}`;
    case 'SPRINT':
      return `chuyển sprint: ${a.oldLabel ?? 'Backlog'} → ${a.newLabel ?? 'Backlog'}`;
    case 'DESCRIPTION':
      return 'sửa mô tả';
    case 'TYPE':
      return 'đổi loại';
    case 'RESOLUTION':
      return 'đổi resolution';
    case 'SCOPE':
      return 'thay đổi phạm vi';
    default:
      return `${a.field}: ${val(a.oldValue)} → ${val(a.newValue)}`;
  }
}
