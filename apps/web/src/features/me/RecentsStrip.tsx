import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { useRecents } from '@/stores/recentIssues';

/** Dải "Xem gần đây" — điều hướng nhanh tới issue vừa mở (localStorage). */
export function RecentsStrip() {
  const recents = useRecents((s) => s.items);
  if (recents.length === 0) return null;
  return (
    <section className="mb-6 print:hidden">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-faint">
        <History className="h-3.5 w-3.5" aria-hidden /> Xem gần đây
      </div>
      <div className="flex flex-wrap gap-2">
        {recents.map((r) => (
          <Link
            key={r.key}
            to={`/issue/${r.key}`}
            title={r.summary}
            className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink transition-colors hover:border-primary hover:bg-primary-subtle"
          >
            <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
            <span className="truncate">{r.summary}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
