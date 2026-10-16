import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { StatusPill } from '@/components/ui/StatusPill';
import { QUICK_SEARCH_MIN_LENGTH, useQuickSearch } from '@/features/command/api';
import { useIssue } from '@/features/issues/api';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { cn } from '@/lib/utils';
import { filterLinkCandidates, looksLikeIssueKey, suggestionsReady } from './linkOptions';

/**
 * Ô tìm công việc để liên kết: gõ mã hoặc tiêu đề (máy chủ tìm không dấu, `useQuickSearch` như Cmd+K); gõ đúng mã
 * thì tra thẳng theo mã và đưa lên đầu. Combobox ARIA: ↑/↓ di chuyển, Enter chọn, Esc đóng danh sách.
 */
export function IssueSearchBox({
  selfId,
  excludeIds,
  onSelect,
  autoFocus,
}: {
  selfId: string;
  excludeIds: Set<string>;
  onSelect: (issue: IssueDto) => void;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebouncedValue(q.trim(), 250);
  // Lấy dư (20) vì sẽ loại chính nó và các việc đã liên kết ở phía này.
  const search = useQuickSearch(term, 20);
  const exact = useIssue(looksLikeIssueKey(term) ? term.toUpperCase() : null);

  const options = useMemo(() => {
    const merged: IssueDto[] = [];
    const seen = new Set<string>();
    for (const i of [...(exact.data ? [exact.data] : []), ...(search.data ?? [])]) {
      if (!seen.has(i.id)) {
        seen.add(i.id);
        merged.push(i);
      }
    }
    return filterLinkCandidates(merged, selfId, excludeIds);
  }, [exact.data, search.data, selfId, excludeIds]);

  useEffect(() => setActive(0), [options]);

  const searching = term.length >= QUICK_SEARCH_MIN_LENGTH || looksLikeIssueKey(term);
  // `placeholderData: keepPreviousData` của useQuickSearch giữ kết quả chuỗi trước trong lúc tải chuỗi mới.
  const pending = search.isFetching || search.isPlaceholderData || exact.isFetching;
  const ready = suggestionsReady(q, term, pending);
  const showList = open && q.trim().length >= QUICK_SEARCH_MIN_LENGTH && searching;
  // Vùng live LUÔN tồn tại (mount sẵn) để trình đọc màn hình đọc được thay đổi; chỉ có chữ khi danh sách đang mở.
  const statusText = !showList
    ? ''
    : !ready
      ? 'Đang tìm…'
      : options.length === 0
        ? 'Không có công việc nào khớp — thử mã hoặc từ khác.'
        : `${options.length} công việc gợi ý`;
  const optId = (i: number) => `${listId}-opt-${i}`;

  function pick(issue: IssueDto) {
    setOpen(false);
    setQ('');
    onSelect(issue);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length)
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Enter') {
      if (showList) {
        e.preventDefault(); // không để Enter lọt ra ngoài khi đang mở danh sách
        // Chỉ chọn khi danh sách khớp đúng chuỗi đang gõ — không chọn nhầm gợi ý cũ còn trong cửa sổ debounce/đang tải.
        if (ready && options[active]) pick(options[active]);
      }
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation(); // đóng danh sách trước, chưa đóng cả form/panel
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <Input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Tìm công việc theo mã hoặc tiêu đề…"
        aria-label="Tìm công việc để liên kết"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? optId(active) : undefined}
        autoComplete="off"
        className="pl-8"
      />
      <span role="status" aria-live="polite" className="sr-only">
        {statusText}
      </span>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Công việc gợi ý"
          aria-busy={!ready}
          // onMouseDown.preventDefault: bấm vào mục không làm ô nhập mất focus (nếu không onBlur đóng danh sách trước khi click).
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {options.map((issue, i) => (
            <li
              key={issue.id}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(issue)}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm',
                i === active && 'bg-surface-2',
                (issue.status.category === 'DONE' || !ready) && 'opacity-70',
              )}
            >
              <IssueTypeIcon type={issue.type} />
              <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{issue.summary}</span>
              <StatusPill status={issue.status} />
            </li>
          ))}
          {options.length === 0 && (
            <li role="presentation" className="px-2.5 py-2 text-sm text-faint">
              {statusText}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
