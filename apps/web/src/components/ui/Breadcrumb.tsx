import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TruncatedLabel } from './TruncatedLabel';

export interface BreadcrumbItem {
  label: string;
  /** Liên kết tới cấp này. Cấp cuối luôn là trang hiện tại nên bị bỏ qua. */
  to?: string;
  /** Cho cấp không phải route (vd Wiki mở trang bằng id). Chỉ dùng khi không có `to`. */
  onClick?: () => void;
  /** Chữ đơn cách (mã công việc, khoá dự án). */
  mono?: boolean;
  /** Gợi ý khi rê chuột (vd tên việc cha); gắn trên link/nút/chữ của cấp. */
  title?: string;
}

interface CrumbExtras {
  mono?: boolean;
  title?: string;
}

export type BreadcrumbEntry = CrumbExtras &
  (
    | { kind: 'current'; label: string }
    | { kind: 'link'; label: string; to: string }
    | { kind: 'button'; label: string; onClick: () => void }
    | { kind: 'text'; label: string }
  );

/**
 * Chuẩn hoá danh sách cấp thành các mục hiển thị:
 *  - bỏ cấp rỗng (tên dự án/việc cha chưa tải hoặc lỗi → không còn hai dấu phân cách liền nhau);
 *  - cấp cuối = trang hiện tại (`current`, không bấm được);
 *  - cấp giữa: `to` → link, `onClick` → nút, không có gì → chữ thường.
 */
export function breadcrumbItems(items: readonly BreadcrumbItem[]): BreadcrumbEntry[] {
  const kept = items
    .map((it) => ({ ...it, label: it.label.trim() }))
    .filter((it) => it.label.length > 0);
  return kept.map((it, i): BreadcrumbEntry => {
    const extras: CrumbExtras = {
      ...(it.mono ? { mono: true } : {}),
      ...(it.title ? { title: it.title } : {}),
    };
    if (i === kept.length - 1) return { kind: 'current', label: it.label, ...extras };
    if (it.to) return { kind: 'link', label: it.label, to: it.to, ...extras };
    if (it.onClick) return { kind: 'button', label: it.label, onClick: it.onClick, ...extras };
    return { kind: 'text', label: it.label, ...extras };
  });
}

const CRUMB = 'min-w-0 max-w-[12rem] sm:max-w-[16rem]';
// Viền focus lấy từ `:focus-visible` toàn cục (globals.css).
const CRUMB_ACTION = 'rounded-sm text-muted transition-colors hover:text-ink-strong';

/** Đường dẫn phân cấp một dòng; cấp dài tự cắt bằng "…" (tooltip chỉ khi bị cắt). */
export function Breadcrumb({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  const entries = breadcrumbItems(items);
  if (entries.length === 0) return null;
  return (
    <nav aria-label="Đường dẫn" className={cn('min-w-0 text-sm text-muted', className)}>
      <ol className="flex min-w-0 items-center gap-1">
        {entries.map((e, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden="true" className="flex shrink-0 text-faint">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
            )}
            <li
              className={cn(
                'flex min-w-0',
                e.kind === 'current' ? 'max-w-[20rem] sm:max-w-[28rem]' : 'shrink-0 sm:shrink',
              )}
            >
              {e.kind === 'link' ? (
                <Link to={e.to} title={e.title} className={cn(CRUMB, CRUMB_ACTION)}>
                  <TruncatedLabel text={e.label} className={cn('block', e.mono && 'font-mono')} />
                </Link>
              ) : e.kind === 'button' ? (
                <button
                  type="button"
                  onClick={e.onClick}
                  title={e.title}
                  className={cn(CRUMB, CRUMB_ACTION)}
                >
                  <TruncatedLabel text={e.label} className={cn('block', e.mono && 'font-mono')} />
                </button>
              ) : e.kind === 'current' ? (
                <span aria-current="page" title={e.title} className="min-w-0 font-medium text-ink">
                  <TruncatedLabel text={e.label} className={cn('block', e.mono && 'font-mono')} />
                </span>
              ) : (
                <span title={e.title} className={CRUMB}>
                  <TruncatedLabel text={e.label} className={cn('block', e.mono && 'font-mono')} />
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
