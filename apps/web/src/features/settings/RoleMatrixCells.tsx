import { useId } from 'react';
import { Check, Lock, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroupState } from './rolePermEdit';

/** Lý do khoá ô của vai trò hệ thống (một nguồn: ghi chú trên bảng + mô tả của ô). */
export const SYSTEM_LOCK_REASON = 'Vai trò hệ thống không sửa được — nhân bản để tuỳ chỉnh';

/**
 * Nút ô: 32px (44px trên màn cảm ứng). Bật/tắt khác nhau hơn màu — dấu tích / gạch ngang + viền; ô khoá thêm biểu tượng ổ khoá.
 * Roving tabindex: cả lưới chỉ MỘT điểm dừng Tab (`tabIndex` do lưới đặt), mũi tên di chuyển giữa các ô.
 */
const CELL_BASE =
  'relative inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border text-xs transition-colors motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ' +
  '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11';

interface CellCommon {
  /** Tên truy cập: "{quyền} — {vai trò}". */
  label: string;
  pos: { r: number; c: number };
  tabIndex: 0 | -1;
  locked: boolean;
  /**
   * Đang chờ điều kiện sửa (danh sách thành viên chưa tải): vẽ ĐÚNG kích thước nút nhưng vô hiệu, để bảng không giãn dòng khi
   * tải xong. Không phải ô khoá (không ổ khoá, không lý do).
   */
  loading?: boolean;
  /** id phần tử mô tả lý do khoá (chỉ khi `locked`). */
  describedBy?: string;
  onToggle: () => void;
}

/** Ô một quyền của một vai trò: nút bật/tắt (`aria-pressed`). Ô khoá: `aria-disabled`, vẫn focus được để đọc lý do. */
export function PermCell({ on, ...c }: CellCommon & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={c.label}
      aria-disabled={c.locked ? 'true' : undefined}
      aria-describedby={c.locked ? c.describedBy : undefined}
      disabled={c.loading}
      tabIndex={c.loading ? -1 : c.tabIndex}
      data-r={c.pos.r}
      data-c={c.pos.c}
      onClick={c.locked || c.loading ? undefined : c.onToggle}
      className={cn(
        CELL_BASE,
        c.loading
          ? cn('cursor-default border-transparent opacity-60', on ? 'text-success' : 'text-faint')
          : c.locked
            ? cn('cursor-not-allowed border-transparent', on ? 'text-success' : 'text-faint')
            : on
              ? 'border-success/50 bg-success/10 text-success hover:bg-success/20'
              : 'border-border text-faint hover:bg-surface-2',
      )}
    >
      {on ? <Check className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
      {c.locked && (
        <Lock className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-faint" aria-hidden />
      )}
    </button>
  );
}

/** Ô NHÓM 3 trạng thái: `aria-pressed` true / false / "mixed"; chữ "n/N" luôn hiện (không chỉ dựa vào màu). */
export function GroupCell({ g, ...c }: CellCommon & { g: GroupState }) {
  // Tên = "{nhóm} — {vai trò}"; trạng thái do aria-pressed nói, số đếm "n/N" đọc qua mô tả (không nhét vào tên).
  const countId = useId();
  const describedBy = [countId, c.locked ? c.describedBy : undefined].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      aria-pressed={g.state === 'partial' ? 'mixed' : g.state === 'full'}
      aria-label={c.label}
      aria-disabled={c.locked ? 'true' : undefined}
      aria-describedby={describedBy}
      disabled={c.loading}
      tabIndex={c.loading ? -1 : c.tabIndex}
      data-r={c.pos.r}
      data-c={c.pos.c}
      onClick={c.locked || c.loading ? undefined : c.onToggle}
      className={cn(
        CELL_BASE,
        'px-1.5',
        c.loading
          ? cn(
              'cursor-default border-transparent opacity-60',
              g.state === 'none' ? 'text-faint' : 'text-success',
            )
          : c.locked
            ? cn(
                'cursor-not-allowed border-transparent',
                g.state === 'none' ? 'text-faint' : 'text-success',
              )
            : g.state === 'full'
              ? 'border-success/50 bg-success/10 text-success hover:bg-success/20'
              : g.state === 'partial'
                ? 'border-border-strong bg-surface-2 text-ink hover:bg-surface-3'
                : 'border-border text-faint hover:bg-surface-2',
      )}
    >
      {g.state === 'full' ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Minus className="h-4 w-4" aria-hidden />
      )}
      <span id={countId} className="tabular-nums">
        {g.count}/{g.total}
        <span className="sr-only"> quyền</span>
      </span>
      {c.locked && (
        <Lock className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-faint" aria-hidden />
      )}
    </button>
  );
}
