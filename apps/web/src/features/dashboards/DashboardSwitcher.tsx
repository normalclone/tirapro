import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { useDashboards } from './api';
import { groupDashboards, scopeBadge } from './dashboardMeta';

/** Giá trị của hàng "Tổng quan chung" (trang chủ cố định, không phải dashboard tuỳ biến). */
const HOME_VALUE = '';
const NEW_VALUE = '__new__';

/**
 * Bộ chọn dashboard ở Tổng quan và ở màn xem: "Tổng quan chung" + các dashboard người xem thấy, NHÓM THEO MỨC CHIA SẺ
 * (Của tôi / Cả không gian / Dự án / Nhóm), mỗi mục kèm huy hiệu mức, cuối cùng là "Tạo dashboard mới…" (người được
 * `dashboard:manage`). Không có gì để chọn hoặc danh sách lỗi → không hiện, để không làm hỏng trang chủ. Không nhớ dashboard xem gần nhất: Tổng quan chung vẫn là
 * trang chủ.
 */
export function DashboardSwitcher({ currentId }: { currentId?: string }) {
  const navigate = useNavigate();
  const { data } = useDashboards();
  const canManage = useAuth((s) => s.can('dashboard:manage'));

  const options = useMemo<SearchSelectOption[]>(() => {
    const opts: SearchSelectOption[] = [{ value: HOME_VALUE, label: 'Tổng quan chung' }];
    for (const g of groupDashboards(data ?? [])) {
      for (const d of g.items) {
        opts.push({ value: d.id, label: d.name, badge: scopeBadge(d), group: g.title });
      }
    }
    if (canManage) opts.push({ value: NEW_VALUE, label: 'Tạo dashboard mới…', group: 'Tạo mới' });
    return opts;
  }, [data, canManage]);

  // Chưa có dashboard nào và không được tạo → không có gì để chọn.
  if (!data || (data.length === 0 && !canManage)) return null;

  return (
    <SearchSelect
      value={currentId ?? HOME_VALUE}
      onChange={(v) =>
        navigate(v === HOME_VALUE ? '/' : v === NEW_VALUE ? '/dashboards/new' : `/dashboards/${v}`)
      }
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
