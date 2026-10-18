import { Dialog } from '@/components/ui/Dialog';
import type { DashboardWidgetType } from '@tirapro/shared';
import { WIDGET_REGISTRY, WIDGET_TYPE_ORDER } from './registry';

/** Danh mục loại ô (từ `WIDGET_REGISTRY`): bấm một loại để thêm vào cuối dashboard. */
export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: DashboardWidgetType) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Thêm widget"
      description="Chọn loại ô — ô mới nằm ở cuối bảng tổng quan, kéo để đổi chỗ."
      size="lg"
    >
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {WIDGET_TYPE_ORDER.map((type) => {
          const def = WIDGET_REGISTRY[type];
          const Icon = def.icon;
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => {
                  onAdd(type);
                  onOpenChange(false);
                }}
                className="flex h-full w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-primary hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-strong">{def.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{def.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
