import { formatCalendarDmy } from '@/lib/calendarDate';
import { toCsv, type CsvColumn } from '@tirapro/shared';
import type { RaidItemDto } from './api';
import { RAID_KIND_LABEL, RAID_LEVEL_META, RAID_STATUS_META } from './constants';

const COLUMNS: CsvColumn<RaidItemDto>[] = [
  { header: 'Loại', value: (i) => RAID_KIND_LABEL[i.kind] },
  { header: 'Tiêu đề', value: (i) => i.title },
  { header: 'Dự án', value: (i) => i.project?.name },
  { header: 'Xác suất', value: (i) => i.probability },
  { header: 'Ảnh hưởng', value: (i) => i.impact },
  { header: 'Điểm', value: (i) => i.score },
  { header: 'Mức', value: (i) => RAID_LEVEL_META[i.level].label },
  { header: 'Trạng thái', value: (i) => RAID_STATUS_META[i.status].label },
  { header: 'Người phụ trách', value: (i) => i.owner?.displayName },
  { header: 'Hạn', value: (i) => formatCalendarDmy(i.dueDate) },
  { header: 'Biện pháp', value: (i) => i.mitigation },
];

/** Sổ RAID đúng như đang hiển thị (danh sách đã lọc truyền vào). */
export function raidCsv(items: RaidItemDto[]): string {
  return toCsv(items, COLUMNS);
}
