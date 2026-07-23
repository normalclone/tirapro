import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Lựa chọn người (assignee) kèm ngữ cảnh: vị trí (vai trò) + nhóm. */
export interface PersonOption {
  id: string;
  name: string;
  avatarUrl?: string | null;
  email?: string;
  /** Vị trí = (các) vai trò, đã nối chuỗi để hiển thị. */
  position?: string;
  teams?: { name: string; color?: string | null }[];
  /** Chuỗi thường-hoá gộp tên + email + vị trí + nhóm để tìm kiếm đa điều kiện. */
  search: string;
}

function MiniTeam({ name, color }: { name: string; color?: string | null }) {
  const c = color ?? 'var(--faint)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in oklch, ${c} 16%, transparent)`, color: c }}
    >
      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
      {name}
    </span>
  );
}

/**
 * Dropdown chọn MỘT NGƯỜI (assignee) — mỗi dòng hiện avatar + tên + vị trí + nhóm.
 * Ô tìm kiếm khớp đồng thời tên / vị trí / nhóm (qua `option.search`).
 */
export function PeoplePicker({
  value,
  onChange,
  options,
  includeEmpty = true,
  emptyLabel = 'Chưa gán',
  disabled,
  align = 'start',
  className,
  ariaLabel = 'Chọn người',
  id,
  searchPlaceholder = 'Tìm tên, vị trí, nhóm…',
  renderTrigger,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PersonOption[];
  includeEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
  className?: string;
  ariaLabel?: string;
  id?: string;
  searchPlaceholder?: string;
  renderTrigger?: (selected: PersonOption | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = options.find((o) => o.id === value);
  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.search.includes(query)) : options;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-3 text-left text-sm transition-colors',
            'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'disabled:opacity-50 data-[state=open]:border-primary',
            className,
          )}
        >
          {renderTrigger ? (
            <span className="min-w-0 flex-1 truncate">{renderTrigger(selected)}</span>
          ) : selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ink">
              <Avatar name={selected.name} src={selected.avatarUrl} size={18} />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-faint">{emptyLabel}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className="z-dropdown w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); pick(filtered[0]!.id); }
              }}
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {includeEmpty && query === '' && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ''}
                  onClick={() => pick('')}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2', value === '' && 'bg-surface-2')}
                >
                  <Check className={cn('h-4 w-4 shrink-0 text-primary', value === '' ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  {emptyLabel}
                </button>
              </li>
            )}
            {filtered.map((o) => {
              const active = o.id === value;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(o.id)}
                    className={cn('flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2', active && 'bg-surface-2')}
                  >
                    <Check className={cn('mt-1.5 h-4 w-4 shrink-0 text-primary', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    <Avatar name={o.name} src={o.avatarUrl} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{o.name}</span>
                      {(o.position || (o.teams && o.teams.length > 0)) && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                          {o.position && <span className="truncate">{o.position}</span>}
                          {o.teams?.map((t) => <MiniTeam key={t.name} name={t.name} color={t.color} />)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted">Không tìm thấy</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
