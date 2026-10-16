import { useRef, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { fmtRelative } from '@/lib/dateFormat';
import { categoryColor } from '@/lib/statusColor';
import { cn } from '@/lib/utils';
import type { DuplicateSuggestion } from './api';
import type { DupSelection } from './dupDecision';

const MAX_SUGGESTIONS = 5;

/** Dòng "Sẽ thêm ghi chú vào X · Đổi" khi người dùng đã chọn gộp — panel thu gọn, không chiếm chỗ. */
function MergeChosen({ keyText, onChange }: { keyText: string; onChange: () => void }) {
  return (
    <div
      id="ri-dup"
      className="mt-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary-subtle/50 px-2.5 py-1.5 text-sm"
    >
      <span className="min-w-0 flex-1 text-ink">
        Sẽ thêm ghi chú vào <span className="font-mono text-xs font-medium">{keyText}</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded px-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Đổi
      </button>
    </div>
  );
}

function MatchRow({
  m,
  showMerge,
  index,
  onMerge,
}: {
  m: DuplicateSuggestion;
  showMerge: boolean;
  index: number;
  onMerge: () => void;
}) {
  return (
    <li className="group rounded-md px-1.5 py-1 hover:bg-surface-2 focus-within:bg-surface-2">
      <div className="flex items-baseline gap-2 text-sm">
        <a
          href={`/issue/${m.key}`}
          target="_blank"
          rel="noreferrer"
          title="Mở trong tab mới để xem chi tiết"
          className="shrink-0 font-mono text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {m.key}
        </a>
        <span className="min-w-0 flex-1 truncate text-ink">{m.summary}</span>
        {m.occurrenceCount > 1 && (
          <span className="shrink-0 text-xs text-faint tabular">×{m.occurrenceCount}</span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: categoryColor(m.status.category) }}
            aria-hidden
          />
          {m.status.name}
        </span>
        <SeverityBadge
          severity={m.severity ? { ...m.severity, description: null } : null}
          compact
        />
        {m.closed && (
          <span className="text-faint">đã đóng{m.resolution ? ` · ${m.resolution}` : ''}</span>
        )}
        {(m.reporterName || m.createdAt) && (
          <span className="text-faint">
            {[m.reporterName, fmtRelative(m.createdAt)].filter(Boolean).join(' · ')}
          </span>
        )}
        {/* Dòng đầu luôn có nút; dòng khác chỉ hiện khi rê/focus (tránh cả danh sách đầy nút). */}
        <button
          type="button"
          data-dup-merge={index}
          onClick={onMerge}
          className={cn(
            'ml-auto rounded-md border border-border bg-surface px-2 py-0.5 font-medium text-ink transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            !showMerge && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
          )}
        >
          Thêm ghi chú vào {m.key}
        </button>
      </div>
    </li>
  );
}

/**
 * Gợi ý trùng khi gõ tiêu đề: danh sách (tối đa 5) + hai hành động rõ ràng — "Thêm ghi chú vào KEY" (mô tả/ảnh thành bình
 * luận, người báo thành người theo dõi) hoặc "Vẫn tạo mới". Bàn phím: ↓ từ ô tiêu đề vào danh sách, ↑/↓ đổi dòng, Enter chọn,
 * Esc đóng panel (hộp thoại lo phần chặn Esc). `aria-live` báo số gợi ý.
 */
export function DuplicatePanel({
  matches,
  selection,
  exact,
  onSelect,
}: {
  matches: DuplicateSuggestion[];
  selection: DupSelection;
  /** Bug còn sống có tiêu đề giống hệt (nếu có) — hiện dòng nhắc nổi bật khi chưa chọn gì. */
  exact: DuplicateSuggestion | undefined;
  onSelect: (s: DupSelection) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (selection.mode === 'merge')
    return <MergeChosen keyText={selection.key} onChange={() => onSelect({ mode: 'none' })} />;

  const shown = matches.slice(0, MAX_SUGGESTIONS);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = [...(ref.current?.querySelectorAll<HTMLElement>('[data-dup-merge]') ?? [])];
    const at = btns.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    if (next < 0) document.getElementById('ri-summary')?.focus();
    else btns[Math.min(next, btns.length - 1)]?.focus();
  }

  return (
    <div
      id="ri-dup"
      ref={ref}
      role="region"
      aria-label="Công việc có thể trùng"
      aria-live="polite"
      onKeyDown={onKeyDown}
      className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2.5"
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
        Có thể trùng ({shown.length}):
      </p>
      {exact && selection.mode === 'none' && (
        <p className="mb-2 rounded bg-warning/20 px-2 py-1.5 text-xs font-medium text-ink">
          Tiêu đề giống hệt {exact.key} — bấm Gửi sẽ thêm vào bug đó (nội dung của bạn được giữ
          thành bình luận).
        </p>
      )}
      <ul className="space-y-1">
        {shown.map((m, i) => (
          <MatchRow
            key={m.id}
            m={m}
            index={i}
            showMerge={i === 0}
            onMerge={() => onSelect({ mode: 'merge', key: m.key, id: m.id })}
          />
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          aria-pressed={selection.mode === 'new'}
          onClick={() => onSelect(selection.mode === 'new' ? { mode: 'none' } : { mode: 'new' })}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            selection.mode === 'new'
              ? 'bg-primary-subtle text-primary'
              : 'text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          {selection.mode === 'new' ? 'Sẽ tạo mới ✓ — bấm để bỏ' : 'Vẫn tạo mới'}
        </button>
      </div>
    </div>
  );
}
