import type { SeverityDto } from '@tirapro/types';
import { cn } from '@/lib/utils';

/** Câu giải nghĩa cố định — hai trục hay bị nhầm (Jira gộp một ô nên người dùng quen nhầm). */
const SEVERITY_VS_PRIORITY =
  'Mức nghiêm trọng = lỗi gây hại kỹ thuật đến đâu; khác với Ưu tiên (độ gấp xử lý).';

/** Dòng giải nghĩa hiện khi rê chuột (tooltip toàn cục bắt thuộc tính `title`). */
export function severityTitle(
  s: Pick<SeverityDto, 'name' | 'description'>,
  suffix?: string,
): string {
  const head = s.description ? `${s.name} — ${s.description}.` : `${s.name}.`;
  return `${head} ${SEVERITY_VS_PRIORITY}${suffix ? ` ${suffix}` : ''}`;
}

/** Ba chữ cái đầu ("Maj"/"Min"/"Cri") — một chữ thì Major và Minor trùng nhau. */
const compactLabel = (name: string) => name.trim().slice(0, 3);

/**
 * Huy hiệu Mức nghiêm trọng của Bug: nền nhạt 14% theo màu mức, chữ cùng màu.
 * `compact` (thẻ board, dòng Việc chờ) chỉ giữ ba chữ cái đầu để không làm màn chính ồn hơn.
 * Chưa đặt mức (`null`) thì không vẽ gì — nơi cần nút "Đặt mức" tự dựng.
 */
export function SeverityBadge({
  severity,
  compact,
  className,
  suffix,
}: {
  severity: Pick<SeverityDto, 'name' | 'description' | 'color'> | null | undefined;
  compact?: boolean;
  className?: string;
  /** Câu nối thêm cuối tooltip (vd "Bấm để đổi."). */
  suffix?: string;
}) {
  if (!severity) return null;
  const c = severity.color;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-xs font-medium',
        compact ? 'h-4 px-1.5 text-[10px] leading-none' : 'gap-1 px-2 py-0.5',
        className,
      )}
      style={{
        color: c ?? 'var(--ink)',
        background: c ? `color-mix(in oklch, ${c} 14%, transparent)` : 'var(--surface-2)',
      }}
      title={severityTitle(severity, suffix)}
      aria-label={`Mức nghiêm trọng: ${severity.name}`}
    >
      {compact ? compactLabel(severity.name) : severity.name}
    </span>
  );
}
