import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/primitives';
import { PersonOptionRow, type PersonHint } from './PersonOptionRow';
import { cn } from '@/lib/utils';
import { registerSessionCleaner } from '@/lib/sessionCache';

/** Lựa chọn người (assignee) kèm ngữ cảnh: vị trí (vai trò) + nhóm. */
export interface PersonOption {
  id: string;
  name: string;
  avatarUrl?: string | null;
  email?: string;
  /** Vị trí = (các) vai trò, đã nối chuỗi để hiển thị. */
  position?: string;
  /** Vai trò dạng mảng (để lọc chính xác theo từng vai trò). */
  roleNames?: string[];
  teams?: { name: string; color?: string | null }[];
  /** Chuỗi thường-hoá gộp tên + email + vị trí + nhóm để tìm kiếm đa điều kiện. */
  search: string;
}

/** Người đã từng thấy trong phiên (từ kết quả tìm) — để ô chọn vẫn hiện tên khi người đang chọn không nằm trong 50 dòng đầu. */
const knownPeople = new Map<string, PersonOption>();
// Đổi tài khoản/đăng xuất: bỏ tên đã nhớ (không rò sang phiên sau).
registerSessionCleaner(() => knownPeople.clear());
export function rememberPeople(options: readonly PersonOption[]): void {
  for (const o of options) knownPeople.set(o.id, o);
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
  onSearchChange,
  moreHint,
  selectedFallback,
  onOpenChange,
  hintFor,
  footerNote,
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
  /** Tìm phía máy chủ: báo từ khoá gõ (nơi gọi debounce rồi nạp lại `options`). Bỏ trống = lọc tại chỗ như cũ. */
  onSearchChange?: (q: string) => void;
  /** Danh sách đã đầy mà chưa gõ → hiện dòng "Gõ để tìm thêm". */
  moreHint?: boolean;
  /** Người đang chọn khi họ không nằm trong `options` (vd người được giao nằm ngoài 50 dòng đầu). */
  selectedFallback?: { id: string; displayName: string; avatarUrl?: string | null };
  /** Báo mở/đóng danh sách (để nơi gọi nạp dữ liệu phụ ĐÚNG MỘT LẦN mỗi lần mở, không theo từng ký tự gõ). */
  onOpenChange?: (open: boolean) => void;
  /** Gợi ý phụ cho từng người (vd "còn trống ~6 giờ/tuần"); null = không hiện gì cho người đó. */
  hintFor?: (userId: string) => PersonHint | null;
  /** Ghi chú cuối danh sách (giải thích cách tính gợi ý). */
  footerNote?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected: PersonOption | undefined =
    options.find((o) => o.id === value) ??
    (value
      ? (knownPeople.get(value) ??
        (selectedFallback?.id === value
          ? {
              id: selectedFallback.id,
              name: selectedFallback.displayName,
              avatarUrl: selectedFallback.avatarUrl,
              search: '',
            }
          : undefined))
      : undefined);
  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.search.includes(query)) : options;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
    onSearchChange?.('');
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        onOpenChange?.(o);
        if (!o) {
          setQ('');
          onSearchChange?.('');
        }
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
            'disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed data-[state=open]:border-primary',
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
              onChange={(e) => {
                setQ(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder={searchPlaceholder}
              autoFocus
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  pick(filtered[0]!.id);
                }
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
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface-2',
                    value === '' && 'bg-surface-2',
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0 text-primary',
                      value === '' ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden
                  />
                  {emptyLabel}
                </button>
              </li>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                <PersonOptionRow
                  option={o}
                  active={o.id === value}
                  onPick={() => pick(o.id)}
                  hint={hintFor?.(o.id)}
                />
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-muted">Không tìm thấy</li>
            )}
            {moreHint && query === '' && (
              <li className="px-2 py-2 text-center text-xs text-faint">Gõ để tìm thêm</li>
            )}
          </ul>
          {footerNote && (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-faint">
              {footerNote}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
