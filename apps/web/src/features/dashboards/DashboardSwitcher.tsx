import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useDashboards } from './api';
import { groupDashboards, scopeBadge } from './dashboardMeta';

/** Giá trị của hàng "Tổng quan chung" (trang chủ cố định, không phải dashboard tuỳ biến). */
const HOME_VALUE = '';

/**
 * Bộ chọn dashboard ở Tổng quan và ở màn xem: "Tổng quan chung" + các dashboard người xem thấy, NHÓM THEO MỨC CHIA SẺ
 * (Của tôi / Cả không gian / Dự án / Nhóm), mỗi mục kèm huy hiệu mức. Không có gì để chọn (chưa có dashboard nào) hoặc
 * danh sách lỗi → không hiện, để không làm hỏng trang chủ. Không nhớ dashboard xem gần nhất: Tổng quan chung vẫn là
 * trang chủ.
 */
export function DashboardSwitcher({ currentId }: { currentId?: string }) {
  const navigate = useNavigate();
  const { data } = useDashboards();

  const options = useMemo<SearchSelectOption[]>(() => {
    const opts: SearchSelectOption[] = [{ value: HOME_VALUE, label: 'Tổng quan chung' }];
    for (const g of groupDashboards(data ?? [])) {
      for (const d of g.items) {
        opts.push({ value: d.id, label: d.name, hint: scopeBadge(d), group: g.title });
      }
    }
    return opts;
  }, [data]);

  if (!data || data.length === 0) return null;

  return (
    <SearchSelect
      value={currentId ?? HOME_VALUE}
      onChange={(v) => navigate(v === HOME_VALUE ? '/' : `/dashboards/${v}`)}
      options={options}
      ariaLabel="Chọn dashboard"
      searchPlaceholder="Tìm dashboard…"
      className="w-full sm:w-64"
      align="end"
      renderTrigger={(selected) => (
        <span className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 shrink-0 text-faint" aria-hidden />
          <span className="truncate">{selected?.label ?? 'Tổng quan chung'}</span>
        </span>
      )}
    />
  );
}
