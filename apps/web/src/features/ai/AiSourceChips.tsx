import { Link } from 'react-router-dom';
import type { AiSource } from '@tirapro/shared';
import { cn } from '@/lib/utils';
import { sourceChips, sourceClickAction } from './aiSources';

/**
 * Nguồn dẫn chứng của gợi ý AI: "[1] TP-5 — Tiêu đề", mỗi chip là link thật tới /issue/KEY. Bấm thường mở xem nhanh khi màn
 * này có (`onPeek`), Cmd/Ctrl+bấm mở tab mới. Nguồn do máy chủ tính theo quyền người xem — mô hình không tự trích.
 * Tên truy cập = chính chữ nhìn thấy (có mã + tiêu đề). Không có nguồn → không vẽ gì.
 */
export function AiSourceChips({
  sources,
  onPeek,
}: {
  sources: readonly AiSource[] | undefined;
  onPeek: ((key: string) => void) | undefined;
}) {
  const chips = sourceChips(sources);
  if (chips.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs text-faint" aria-hidden="true">
        Dựa trên các việc tương tự:
      </p>
      <ol aria-label="Nguồn tham khảo" className="mt-1 flex flex-col gap-1">
        {chips.map((c) => (
          <li key={c.key} className="min-w-0">
            <Link
              to={c.href}
              draggable={false}
              title={`${c.key} — ${c.summary}. Bấm để xem nhanh, Cmd/Ctrl+bấm để mở tab mới`}
              className={cn(
                'inline-flex max-w-full items-center rounded border border-border bg-surface-2 px-2 py-1 text-xs text-ink transition-colors hover:border-primary hover:text-primary motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11',
              )}
              onClick={(e) => {
                if (sourceClickAction(e, !!onPeek) !== 'peek') return; // link thật tự xử lý (tab mới / điều hướng)
                e.preventDefault();
                onPeek?.(c.key);
              }}
            >
              <span className="truncate">{c.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
