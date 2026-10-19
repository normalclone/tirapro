import type { ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/Breadcrumb';
import { cn } from '@/lib/utils';
import { BackLink } from './BackLink';

export type PageHeaderVariant = 'page' | 'tab';

/** `page` = tiêu đề trang (h1, mỗi route đúng một); `tab` = tab trong dự án, đã có h1 của header dự án → h2. */
export function pageHeaderTag(variant: PageHeaderVariant = 'page'): 'h1' | 'h2' {
  return variant === 'tab' ? 'h2' : 'h1';
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Một dòng mô tả (muted). */
  description?: ReactNode;
  /** Đường dẫn phân cấp phía trên tiêu đề. */
  breadcrumb?: readonly BreadcrumbItem[];
  /**
   * Breadcrumb có hiện dưới `lg` không (mặc định có). Trang nằm trong `SubNavLayout` (Cài đặt/Danh mục/Kết nối…)
   * truyền `false`: ở mobile đã có "‹ Khu vực" do layout vẽ nên một cấp là đủ. Tách hẳn khỏi `back` (RB3).
   */
  breadcrumbMobile?: boolean;
  /** Nút phải: tối đa MỘT nút chính; dưới `sm` xuống dòng riêng. */
  actions?: ReactNode;
  /** Mobile "bước vào": link "‹ Cài đặt" đầu trang con, chỉ hiện dưới `lg`. */
  back?: { label: string; to: string };
  variant?: PageHeaderVariant;
  /**
   * Tiêu đề chỉ dành cho trình đọc màn hình (`sr-only`): trang đã có tiêu đề hiển thị riêng không thể nằm trong h1
   * (vd chi tiết công việc: ô sửa tiêu đề tại chỗ kèm các ô chọn loại/ưu tiên). Khi đó breadcrumb và actions chung một
   * hàng; `description` không dùng.
   */
  titleHidden?: boolean;
  /** `id` của thẻ tiêu đề — cho `aria-labelledby` của vùng nội dung. */
  titleId?: string;
  className?: string;
  /** Neo tour hướng dẫn (đặt trên `<header>`). */
  'data-tour'?: string;
}

/**
 * Đầu trang chuẩn (B-D2): [breadcrumb] → tiêu đề (không icon) → mô tả ≤ 1 dòng · actions bên phải.
 * Đặt làm con đầu tiên của `PageFrame`.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  breadcrumbMobile = true,
  actions,
  back,
  variant = 'page',
  titleHidden = false,
  titleId,
  className,
  ...rest
}: PageHeaderProps) {
  const Heading = pageHeaderTag(variant);
  const hasCrumb = !!breadcrumb && breadcrumb.some((b) => b.label.trim() !== '');
  if (titleHidden) {
    return (
      <header className={cn('mb-4', className)} {...rest}>
        {back && <BackLink label={back.label} to={back.to} className="-ml-1 mb-3" />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {hasCrumb && (
            <Breadcrumb
              items={breadcrumb}
              className={cn('flex-1 basis-60', !breadcrumbMobile && 'max-lg:hidden')}
            />
          )}
          {actions && (
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
        <Heading id={titleId} className="sr-only">
          {title}
        </Heading>
      </header>
    );
  }
  return (
    <header className={cn('mb-6', className)} {...rest}>
      {back && <BackLink label={back.label} to={back.to} className="-ml-1 mb-3" />}
      {hasCrumb && (
        <Breadcrumb
          items={breadcrumb}
          className={cn('mb-2', !breadcrumbMobile && 'max-lg:hidden')}
        />
      )}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <Heading
            id={titleId}
            className={cn(
              'font-semibold tracking-tight text-ink-strong',
              variant === 'tab' ? 'text-xl' : 'text-2xl',
            )}
          >
            {title}
          </Heading>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div>
        )}
      </div>
    </header>
  );
}
