import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DESKTOP_MIN_QUERY } from '@/lib/bottomBar';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from '@/components/ui/TruncatedLabel';
import { BackLink } from './BackLink';
import { PAGE_FRAME_WIDTH, PageFrame, type PageFrameSize } from './PageFrame';
import { PageHeader, type PageHeaderVariant } from './PageHeader';
import { isIndexPath, visibleGroups, type SubNavGroup } from './subNavModel';

interface SubNavLayoutProps {
  /** Tên khu vực ("Cài đặt"): chữ phụ trên rail, tiêu đề trang danh sách mục (mobile) và nhãn "‹ Cài đặt". */
  title: string;
  ariaLabel: string;
  /** Đã lọc quyền ở nơi gọi (mục `hidden` vẫn bị bỏ). */
  groups: SubNavGroup[];
  /** Trang danh sách mục, vd "/settings". */
  basePath: string;
  /** Chèn trên cùng rail, danh sách và hàng quay lại ở trang con (vd link "Về dự án X"). */
  top?: ReactNode;
  /**
   * Cỡ `PageFrame` thường dùng của các trang con khu vực này (B-D1): hàng "‹ Khu vực" và danh sách mục dùng cùng bề
   * rộng để thẳng lề với tiêu đề trang ở cỡ md. Trang con dùng cỡ khác thì chỉ lệch ở 768–1023px.
   */
  frameSize?: PageFrameSize;
  /**
   * Cấp tiêu đề của danh sách mục (mobile): `page` = h1 (khu vực có trang riêng: Cài đặt/Danh mục/Kết nối); `tab` = h2
   * khi trang nằm dưới một h1 có sẵn (Cấu hình dự án: h1 là tên dự án ở header dự án).
   */
  variant?: PageHeaderVariant;
}

/**
 * Khung có menu con cho một khu vực (Cài đặt / Danh mục / Kết nối), mỗi mục là một route con (`<Outlet/>`).
 *
 *  - Từ `lg`: rail dọc 240px bên trái. Đường dẫn gốc (`basePath`) vẫn chạy route index (redirect tới mục đầu tiên).
 *  - Dưới `lg` ("bước vào"): ở `basePath` hiện DANH SÁCH mục toàn chiều rộng (không render Outlet nên redirect
 *    không chạy); chọn mục → sang route con, đầu trang có "‹ {title}" quay về danh sách. Back của trình duyệt
 *    tự quay về danh sách vì đây là route thật.
 *
 * Rail không có heading (h1 thuộc `PageHeader` của từng trang con; danh sách mục có h1 riêng là `title`).
 */
export function SubNavLayout({
  title,
  ariaLabel,
  groups,
  basePath,
  top,
  frameSize = 'sm',
  variant = 'page',
}: SubNavLayoutProps) {
  const { pathname, search } = useLocation();
  const isDesktop = useMediaQuery(DESKTOP_MIN_QUERY);
  const shown = visibleGroups(groups);
  const showList = !isDesktop && isIndexPath(pathname, basePath);

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <nav
        aria-label={ariaLabel}
        className="hidden shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface px-3 py-5 lg:flex lg:w-60"
      >
        <p className="px-3 pb-2 text-xs font-semibold text-faint">{title}</p>
        {top}
        {shown.map((g, gi) => (
          <div key={g.label ?? gi} className="flex flex-col gap-0.5 pb-1">
            {g.label && <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted">{g.label}</p>}
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-subtle text-primary'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <TruncatedLabel text={item.label} />
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        {showList ? (
          <SubNavList
            title={title}
            ariaLabel={ariaLabel}
            groups={shown}
            top={top}
            frameSize={frameSize}
            variant={variant}
          />
        ) : (
          <>
            {!isIndexPath(pathname, basePath) && (
              <div
                className={cn(
                  'mx-auto flex w-full flex-wrap items-center gap-x-3 px-4 pt-3 sm:px-6 lg:hidden',
                  PAGE_FRAME_WIDTH[frameSize],
                )}
              >
                {/* Giữ ?query (vd ?project=<id> của Kết nối) để danh sách mục còn nhớ dự án nguồn. */}
                <BackLink label={title} to={`${basePath}${search}`} />
                {top}
              </div>
            )}
            <Outlet />
          </>
        )}
      </div>
    </div>
  );
}

/** Trang danh sách mục (chỉ dưới `lg`): mỗi nhóm một khối, mỗi mục một hàng icon + nhãn + chevron. */
function SubNavList({
  title,
  ariaLabel,
  groups,
  top,
  frameSize,
  variant,
}: Pick<SubNavLayoutProps, 'title' | 'ariaLabel' | 'top'> & {
  groups: SubNavGroup[];
  frameSize: PageFrameSize;
  variant: PageHeaderVariant;
}) {
  return (
    <PageFrame size={frameSize}>
      <PageHeader title={title} variant={variant} />
      <nav aria-label={ariaLabel} className="space-y-6">
        {top}
        {groups.map((g, gi) => (
          <section key={g.label ?? gi}>
            {g.label && <h2 className="px-1 pb-2 text-xs font-medium text-muted">{g.label}</h2>}
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {g.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex min-h-12 items-center gap-3 px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
                  >
                    {item.icon && (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                        {item.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </PageFrame>
  );
}
