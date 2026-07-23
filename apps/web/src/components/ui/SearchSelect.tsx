import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  color?: string | null;
  /** Nội dung phụ bên phải (vd: key issue, mã). */
  hint?: string;
}

/**
 * Dropdown chọn-một CÓ Ô TÌM KIẾM — thay cho `<select>` native khi danh sách >5 lựa chọn
 * hoặc số lượng không xác định (data động: người dùng, dự án, trạng thái…).
 *
 * Dùng như select: truyền `value` (chuỗi), `onChange(value)`, và `options`.
 * Lựa chọn rỗng (vd "Chưa gán") chỉ cần là một option `{ value: '', label: 'Chưa gán' }`.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm…',
  disabled,
  id,
  ariaLabel,
  className,
  align = 'start',
  renderTrigger,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
  align?: 'start' | 'end';
  /** Tuỳ biến nội dung trigger (mặc định: label của option đang chọn). */
  renderTrigger?: (selected: SearchSelectOption | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = options.find((o) => o.value === value);
  const query = q.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) => o.label.toLowerCase().includes(query) || o.value.toLowerCase().includes(query),
      )
    : options;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
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
          ) : (
            <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-ink' : 'text-faint')}>
              {selected ? selected.label : placeholder}
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className="z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  pick(filtered[0].value);
                }
              }}
            />
          </div>
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value || '__empty__'}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2',
                      active && 'bg-surface-2',
                    )}
                  >
                    <Check
                      className={cn('h-4 w-4 shrink-0 text-primary', active ? 'opacity-100' : 'opacity-0')}
                      aria-hidden
                    />
                    {o.color && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: o.color }}
                        aria-hidden
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 font-mono text-xs text-faint">{o.hint}</span>}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-muted">Không có lựa chọn</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
