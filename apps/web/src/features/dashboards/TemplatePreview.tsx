import type { DashboardDataScopeValue, DashboardTemplate } from '@tirapro/shared';
import { cn } from '@/lib/utils';
import { previewBlocks } from './previewBlocks';
import { widgetDefOf } from './registry';

/** Hình xem trước luôn 3 cột (không đổi theo cỡ màn như bảng thật). Chuỗi class viết nguyên văn để Tailwind quét được. */
const SPAN = { 1: '', 2: 'col-span-2', 3: 'col-span-3' } as const;

/**
 * Hình xem trước của mẫu: sơ đồ khối trên lưới 3 cột (đúng cỡ cột của từng ô), mỗi khối ghi tên ô.
 * Mang nghĩa bằng chữ + vị trí nên không phụ thuộc màu; chỉ là hình minh hoạ (aria-hidden), mô tả đã nằm ở danh sách bên cạnh.
 */
export function TemplatePreview({
  template,
  scope,
  className,
}: {
  template: DashboardTemplate;
  scope: DashboardDataScopeValue;
  className?: string;
}) {
  const blocks = previewBlocks(template, scope);
  if (blocks.length === 0) {
    return (
      <div
        className={cn(
          'flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border-strong text-sm text-muted',
          className,
        )}
      >
        Trang trắng — bạn tự thêm ô
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn('grid grid-cols-3 gap-2 rounded-lg border border-border bg-bg p-2', className)}
    >
      {blocks.map((b) => {
        const Icon = widgetDefOf(b.type)?.icon;
        return (
          <div
            key={b.key}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-2',
              SPAN[b.w],
              b.rows === 2 ? 'min-h-20' : 'min-h-11',
            )}
          >
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted">
              {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
              <span className="truncate">{b.title}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
