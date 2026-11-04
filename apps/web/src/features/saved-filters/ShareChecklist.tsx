import { useId, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/primitives';
import { Input } from '@/components/ui/Input';
import { matchesQuery } from '@/lib/text';
import { cn } from '@/lib/utils';

export interface ChecklistItem {
  id: string;
  label: string;
  /** Dòng phụ (mã dự án, email). */
  hint?: string;
  /** Có → hiện avatar (danh sách người). */
  person?: { avatarUrl: string | null };
}

/** Lọc theo tên/dòng phụ, không phân biệt hoa thường/dấu; mục ĐÃ CHỌN luôn còn trong danh sách dù không khớp ô tìm. */
export function filterChecklist(
  items: readonly ChecklistItem[],
  query: string,
  selected: ReadonlySet<string>,
): ChecklistItem[] {
  return items.filter((i) => selected.has(i.id) || matchesQuery(query, i.label, i.hint));
}

/**
 * Danh sách tích chọn nhiều mục có ô tìm (dự án / người). Mỗi dòng là một `<label>` + ô tích thật (bàn phím, trình đọc
 * màn hình). Mục đã chọn nổi lên đầu để thấy ngay mình đã chọn gì khi danh sách dài.
 */
export function ShareChecklist({
  label,
  items,
  selected,
  onToggle,
  searchPlaceholder,
  emptyText,
  disabled,
}: {
  label: string;
  items: readonly ChecklistItem[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const headId = useId();
  const rows = useMemo(() => {
    const shown = filterChecklist(items, q, selected);
    return [
      ...shown.filter((i) => selected.has(i.id)),
      ...shown.filter((i) => !selected.has(i.id)),
    ];
  }, [items, q, selected]);

  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend
        id={headId}
        className="mb-1.5 flex w-full items-baseline justify-between text-sm font-medium text-ink"
      >
        <span>{label}</span>
        <span className="tabular text-xs font-normal text-muted">
          {selected.size > 0 ? `Đã chọn ${selected.size}` : 'Chưa chọn'}
        </span>
      </legend>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={`Tìm trong: ${label}`}
        className="text-sm"
      />
      <ul
        aria-labelledby={headId}
        className="mt-1.5 max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border"
      >
        {rows.length === 0 && <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>}
        {rows.map((i) => (
          <li key={i.id}>
            <label
              className={cn(
                'flex min-h-9 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-surface-2 [@media(pointer:coarse)]:min-h-11',
                selected.has(i.id) && 'bg-primary-subtle/50',
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                checked={selected.has(i.id)}
                onChange={() => onToggle(i.id)}
              />
              {i.person && <Avatar name={i.label} src={i.person.avatarUrl} size={22} decorative />}
              <span className="min-w-0 flex-1 truncate text-ink">{i.label}</span>
              {i.hint && <span className="shrink-0 truncate text-xs text-muted">{i.hint}</span>}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
