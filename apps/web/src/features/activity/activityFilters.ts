import type { ActivityItem } from './api';
import { TERM } from '@/lib/terms';

/** Chip lọc của tab Lịch sử. `fields` = giá trị `HistoryField` gửi lên `GET /issues/:id/activity?fields=`; rỗng = tất cả. */
export const ACTIVITY_FILTERS: { id: string; label: string; fields: string[] }[] = [
  { id: 'all', label: 'Tất cả', fields: [] },
  { id: 'status', label: 'Trạng thái', fields: ['STATUS'] },
  { id: 'points', label: 'Điểm', fields: ['STORY_POINTS'] },
  { id: 'assignee', label: 'Người phụ trách', fields: ['ASSIGNEE'] },
  { id: 'priority', label: 'Ưu tiên', fields: ['PRIORITY'] },
  { id: 'sprint', label: 'Sprint', fields: ['SPRINT'] },
  { id: 'description', label: 'Mô tả', fields: ['DESCRIPTION'] },
  {
    id: 'other',
    label: 'Khác',
    fields: ['TYPE', 'RESOLUTION', 'SCOPE', 'TIME_SPENT', 'COMPONENT', 'FIX_VERSION'],
  },
];

/** CSV cho `?fields=`; `undefined` cho "Tất cả" hoặc id lạ. */
export function fieldsParam(filterId: string): string | undefined {
  const f = ACTIVITY_FILTERS.find((x) => x.id === filterId);
  return f && f.fields.length ? f.fields.join(',') : undefined;
}

/** Giá trị hiển thị, rỗng → dấu gạch. */
const val = (v: string | null): string => (v != null && v !== '' ? v : '—');

/** Phiên bản lưu `FIX:v1.0` / `AFFECTS:v1.0` (máy chủ ghi kèm loại); giá trị lạ coi như tên thuần, loại FIX. */
function parseVersionValue(v: string | null): { type: 'FIX' | 'AFFECTS'; name: string } | null {
  if (!v) return null;
  const m = /^(FIX|AFFECTS):(.*)$/s.exec(v);
  return m ? { type: m[1] as 'FIX' | 'AFFECTS', name: m[2]! } : { type: 'FIX', name: v };
}

type ActivityLike = Pick<ActivityItem, 'field' | 'oldValue' | 'newValue' | 'oldLabel' | 'newLabel'>;

/** Mô tả tiếng Việt cho một thay đổi (người/sprint dùng nhãn đã phân giải ở máy chủ). */
export function describeActivity(a: ActivityLike): string {
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
      return `chuyển sprint: ${a.oldLabel ?? TERM.backlog} → ${a.newLabel ?? TERM.backlog}`;
    case 'DESCRIPTION':
      return 'sửa mô tả';
    case 'COMPONENT':
      return a.newValue ? `gắn thành phần: ${a.newValue}` : `bỏ thành phần: ${val(a.oldValue)}`;
    case 'FIX_VERSION': {
      const v = parseVersionValue(a.newValue ?? a.oldValue);
      const kind = v?.type === 'AFFECTS' ? 'phiên bản bị ảnh hưởng' : 'phiên bản sửa';
      return `${a.newValue ? 'gắn' : 'bỏ'} ${kind}: ${v?.name ?? '—'}`;
    }
    case 'TYPE':
      return 'đổi loại';
    case 'RESOLUTION':
      return 'đổi kết quả xử lý';
    case 'TIME_SPENT':
      // Giá trị đã được API định dạng ("1h 30m"); lần ghi đầu chưa có giá trị cũ.
      return a.oldValue
        ? `ghi thời gian: ${a.oldValue} → ${val(a.newValue)}`
        : `ghi thời gian: ${val(a.newValue)}`;
    case 'SCOPE':
      return 'thay đổi phạm vi';
    default:
      // Không bao giờ in tên enum/trường thô (HistoryField có thể thêm loại mới trước khi giao diện kịp dịch).
      return 'cập nhật thông tin';
  }
}

/**
 * Loại thay đổi mà feed hoạt động dự án phải viết thành MỘT câu thuần, không dựng cặp chip cũ → mới: mô tả (bản xem trước
 * dài, lộ nội dung), gắn/bỏ thành phần-phiên bản và ghi thời gian. `null` = loại khác, feed tự dựng chip như trước.
 */
export function projectFeedSentence(a: ActivityLike): string | null {
  return a.field === 'DESCRIPTION' ||
    a.field === 'COMPONENT' ||
    a.field === 'FIX_VERSION' ||
    a.field === 'TIME_SPENT'
    ? `đã ${describeActivity(a)}`
    : null;
}
