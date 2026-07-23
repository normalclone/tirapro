import { cn } from '@/lib/utils';

/**
 * Nhãn LOẠI issue (Story/Bug/Task/Epic/Sub) — tô màu theo màu của loại để phân biệt
 * nhanh độ quan trọng (Bug đỏ, Epic tím…). Nền tô nhẹ + chữ/đốm dùng chính màu loại,
 * giữ tương phản AA ở cả light/dark. Đồng bộ cách làm với RoleBadge.
 */
export function IssueTypeBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  const c = color || 'var(--faint)';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold',
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} aria-hidden />
      {name}
    </span>
  );
}
