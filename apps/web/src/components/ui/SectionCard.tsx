import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SectionCardTone = 'primary' | 'neutral';

const TILE_TONE: Record<SectionCardTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  // Cho logo/biểu tượng có màu riêng (nền trung tính, không ép màu chữ).
  neutral: 'bg-surface-2',
};

/** Cấp tiêu đề của card: h2 (mặc định) hoặc h3 khi card nằm dưới một h2 khác. */
export function sectionHeadingTag(level: 2 | 3 = 2): 'h2' | 'h3' {
  return level === 3 ? 'h3' : 'h2';
}

interface SectionCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Ô icon bên trái tiêu đề (tuỳ chọn). */
  icon?: ReactNode;
  iconTone?: SectionCardTone;
  title: string;
  description?: ReactNode;
  /** Hành động PHỤ nằm trong card (không phải nút "Tạo X" của trang — nút đó thuộc `PageHeader.actions`). */
  actions?: ReactNode;
  /** Thanh đáy căn phải, vd Lưu/Huỷ. */
  footer?: ReactNode;
  /** Thân không đệm `p-5` (danh sách có đường kẻ sát mép, hoặc con tự đệm). */
  bare?: boolean;
  headingLevel?: 2 | 3;
  /** Neo tour hướng dẫn. */
  'data-tour'?: string;
}

/** Card chuẩn cho một nhóm nội dung: [icon] tiêu đề + mô tả · actions / thân / footer. */
export function SectionCard({
  icon,
  iconTone = 'primary',
  title,
  description,
  actions,
  footer,
  bare = false,
  headingLevel = 2,
  className,
  children,
  ...rest
}: SectionCardProps) {
  const Heading = sectionHeadingTag(headingLevel);
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)} {...rest}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3 border-b border-border px-5 py-4">
        {icon && (
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              TILE_TONE[iconTone],
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1 basis-48">
          <Heading className="text-base font-semibold text-ink-strong">{title}</Heading>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>
        )}
      </div>
      <div className={bare ? undefined : 'p-5'}>{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}
