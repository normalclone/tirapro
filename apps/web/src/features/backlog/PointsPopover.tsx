import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { parsePointsInput } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** Dãy Fibonacci hay dùng khi ước lượng — chỉ là lối tắt, ô tự do vẫn nhập được số bất kỳ 0–1000. */
export const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13, 21] as const;

/**
 * Đặt điểm ước lượng cho cả lô: bấm một chip hoặc gõ số + Enter để áp dụng; để trống rồi Enter = xoá điểm.
 */
export function PointsPopover({
  onApply,
  disabled,
}: {
  onApply: (points: number | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');

  function apply(value: number | null) {
    setOpen(false);
    setRaw('');
    onApply(value);
  }
  function submit() {
    const r = parsePointsInput(raw);
    if (!r.ok) return void toast.error(r.error);
    apply(r.value);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setRaw('');
      }}
    >
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          title="Đặt điểm ước lượng cho các việc đang chọn"
        >
          <Gauge className="h-4 w-4" />
          Điểm
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-64 rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="mb-2 text-xs text-muted">Điểm cho tất cả việc đang chọn</p>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Điểm hay dùng">
            {FIBONACCI_POINTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => apply(n)}
                className={cn(
                  'tabular grid h-7 min-w-8 place-items-center rounded-md border border-border bg-bg px-2 text-sm text-ink transition-colors hover:border-primary hover:bg-surface-2',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              type="number"
              min={0}
              max={1000}
              step="any"
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Số khác"
              aria-label="Điểm ước lượng (số bất kỳ từ 0 đến 1000)"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button size="sm" onClick={submit}>
              Áp dụng
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-faint">Để trống rồi áp dụng = xoá điểm.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
