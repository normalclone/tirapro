import { cn } from '@/lib/utils';
import { BulletBar, type BulletBarProps } from './BulletBar';

type StatTone = 'default' | 'progress' | 'done' | 'danger' | 'warning' | 'bug' | 'primary';

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-ink-strong',
  progress: 'text-status-progress',
  done: 'text-status-done',
  danger: 'text-danger',
  // text-warning (~2.4:1 trên nền sáng) không đạt AA ở cỡ chữ này → dùng warning-ink như bản Báo cáo cũ.
  warning: 'text-warning-ink',
  bug: 'text-danger', // đỏ như "Quá hạn" nhưng KHÔNG có nền cảnh báo (không cùng vị trí nên không rối)
  primary: 'text-primary',
};

export interface StatItem {
  label: string;
  value: number | string;
  /** Dòng phụ nhỏ dưới giá trị (đơn vị, số việc, khoảng ngày…). */
  sub?: string;
  tone?: StatTone;
  /** Nền nhấn nhẹ (vd quá hạn > 0). */
  highlight?: boolean;
  /** Giải nghĩa số liệu, hiện khi rê chuột (tooltip toàn cục bắt thuộc tính `title`). */
  title?: string;
  /** Thanh tiến độ/đích — CHỈ khi có đích thật (hoặc thang thật); ô không đích để trống. Tên thanh = nhãn ô (hoặc `bullet.label` khi thanh đo cái khác số lớn). */
  bullet?: Omit<BulletBarProps, 'label'> & { label?: string };
}

/** Số cột trên sm+ khớp đúng số ô → không để lại ô trống viền. */
const SM_COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

/**
 * Hàng chỉ số liền khối (không phải lưới thẻ lặp): mỗi ô nhãn + số cỡ vừa + dòng phụ + (tuỳ chọn) `BulletBar`.
 * Một nơi duy nhất cho Tổng quan, Báo cáo, QA, Quản trị và ô "Chỉ số" của dashboard tuỳ biến.
 * `cols` thay cách chia cột mặc định (kèm quy tắc ô lẻ cuối) khi nơi dùng cần bố cục riêng.
 */
export function StatRow({
  items,
  className,
  cols,
  bare,
}: {
  items: StatItem[];
  className?: string;
  cols?: string;
  /** Ô nằm TRONG một khung đã có viền + đệm (vd ô dashboard tuỳ biến): bỏ viền/bo/nền/đệm của hàng chỉ số. */
  bare?: boolean;
}) {
  const oddTail = cols === undefined && items.length % 2 === 1; // mobile 2 cột → ô cuối lẻ span 2 cho kín
  return (
    <div
      className={cn(
        'print-avoid-break grid grid-cols-2 gap-px overflow-hidden',
        bare ? 'rounded-none' : 'rounded-lg border border-border bg-border',
        cols ?? SM_COLS[items.length] ?? 'sm:grid-cols-4',
        className,
      )}
    >
      {items.map((s, idx) => (
        <div
          key={s.label}
          title={s.title}
          className={cn(
            bare ? 'p-0' : 'px-4 py-2.5',
            // bare: không tô nền nhấn (sẽ thành khối hồng sát mép khung) — chữ/thanh đỏ đã báo hiệu.
            bare ? 'bg-transparent' : s.highlight ? 'bg-danger/5' : 'bg-surface',
            oddTail && idx === items.length - 1 && 'max-sm:col-span-2',
          )}
        >
          <p className="text-xs font-medium text-muted">{s.label}</p>
          <p
            className={cn('tabular mt-0.5 text-lg font-semibold', VALUE_TONE[s.tone ?? 'default'])}
          >
            {s.value}
          </p>
          {s.sub && <p className="mt-0.5 break-words text-xs text-muted">{s.sub}</p>}
          {s.bullet && (
            <BulletBar {...s.bullet} label={s.bullet.label ?? s.label} className="mt-1.5" />
          )}
        </div>
      ))}
    </div>
  );
}
