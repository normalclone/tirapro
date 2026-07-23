import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Màu dự phòng khi vai trò chưa đặt màu (token faint, trung tính). */
const FALLBACK_COLOR = 'var(--faint)';

/**
 * Nhãn vai trò (pill) — nền tô NHẸ theo màu vai trò + chữ/đốm dùng chính màu đó.
 * KHÔNG dùng side-stripe; nền lấy từ `color-mix` để giữ độ tương phản AA ở cả
 * light/dark. Dùng nhất quán ở mọi nơi hiển thị vai trò (catalog, thành viên…).
 */
export function RoleBadge({
  name,
  color,
  className,
  title,
  trailing,
}: {
  name: string;
  color?: string | null;
  className?: string;
  /** Tooltip (mặc định = tên vai trò). */
  title?: string;
  /** Nội dung phụ bên phải pill (vd nút gỡ). */
  trailing?: ReactNode;
}) {
  const c = color || FALLBACK_COLOR;
  return (
    <span
      title={title ?? name}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        // Nền tô nhẹ ~16% màu vai trò, chữ dùng nguyên màu vai trò.
        backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`,
        color: c,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: c }}
        aria-hidden
      />
      <span className="min-w-0 truncate">{name}</span>
      {trailing}
    </span>
  );
}
