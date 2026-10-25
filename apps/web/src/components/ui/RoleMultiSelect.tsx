import { useId, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Lock } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { cn } from '@/lib/utils';
import { roleLabel } from '@tirapro/types';
import { roleHint } from '@/lib/roleLabels';
import { toggleRoleIds } from '@/lib/roleSet';

export interface RoleOption {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * Chọn NHIỀU vai trò — dropdown có ô tìm + checklist. Hiển thị các vai trò đã chọn
 * dưới dạng `RoleBadge` ngay trên trigger. Bắt buộc ≥1 (không cho bỏ chọn vai trò
 * cuối cùng) khi `requireOne`. Dùng chung cho gán vai trò thành viên khi thêm người.
 */
export function RoleMultiSelect({
  options,
  value,
  onChange,
  disabled,
  requireOne = true,
  placeholder = 'Chọn vai trò…',
  ariaLabel = 'Chọn vai trò',
  id,
  searchPlaceholder = 'Tìm vai trò…',
  onSearchChange,
  moreHint,
  resolveOption,
  locked,
  frozen,
}: {
  options: RoleOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Vai trò KHÔNG được bỏ chọn (id → lý do hiển thị ngay dưới nhãn). */
  locked?: Record<string, string>;
  /** Vai trò KHÔNG bật cũng không tắt được (id → lý do), vd vai trò quản trị với người không phải quản trị (P-C14). */
  frozen?: Record<string, string>;
  disabled?: boolean;
  requireOne?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  searchPlaceholder?: string;
  /** Tìm phía máy chủ (chọn người): báo từ khoá gõ; nơi gọi debounce rồi nạp lại `options`. */
  onSearchChange?: (q: string) => void;
  moreHint?: boolean;
  /** Tra mục đã chọn không nằm trong `options` hiện tại. */
  resolveOption?: (id: string) => RoleOption | undefined;
}) {
  const [open, setOpen] = useState(false);

  const selected = value.flatMap((id) => {
    const o = options.find((x) => x.id === id) ?? resolveOption?.(id);
    return o ? [o] : [];
  });

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onSearchChange?.('');
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'flex min-h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1 text-left text-sm transition-colors',
            'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            'disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed data-[state=open]:border-primary',
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selected.length === 0 ? (
              <span className="text-faint">{placeholder}</span>
            ) : (
              selected.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <RoleChecklist
            options={options}
            value={value}
            onChange={onChange}
            requireOne={requireOne}
            locked={locked}
            frozen={frozen}
            ariaLabel={ariaLabel}
            searchPlaceholder={searchPlaceholder}
            onSearchChange={onSearchChange}
            moreHint={moreHint}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Phần danh sách của `RoleMultiSelect` (ô tìm + checklist) dùng được ĐỘC LẬP — khi đã nằm trong một popover khác
 * (vd đổi vai trò ngay trên hàng thành viên) thì không lồng thêm một dropdown nữa.
 */
export function RoleChecklist({
  options,
  value,
  onChange,
  requireOne = true,
  locked,
  frozen,
  ariaLabel = 'Chọn vai trò',
  searchPlaceholder = 'Tìm vai trò…',
  onSearchChange,
  moreHint,
  autoFocusSearch = true,
}: {
  options: RoleOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  requireOne?: boolean;
  /** Vai trò KHÔNG được bỏ chọn (id → lý do). */
  locked?: Record<string, string>;
  /** Vai trò KHÔNG bật cũng không tắt được (id → lý do) — P-C14. */
  frozen?: Record<string, string>;
  ariaLabel?: string;
  searchPlaceholder?: string;
  onSearchChange?: (q: string) => void;
  moreHint?: boolean;
  autoFocusSearch?: boolean;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const filtered = query
    ? options.filter((o) => `${o.name} ${roleLabel(o.name)}`.toLowerCase().includes(query))
    : options;

  function toggle(id: string) {
    const next = toggleRoleIds(value, id, { requireOne, locked, frozen });
    if (next !== value) onChange(next);
  }

  return (
    <>
      <div className="border-b border-border p-2">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onSearchChange?.(e.target.value);
          }}
          placeholder={searchPlaceholder}
          autoFocus={autoFocusSearch}
          className="h-8 text-sm"
        />
      </div>
      <ul
        className="max-h-64 overflow-y-auto p-1"
        role="listbox"
        aria-multiselectable
        aria-label={ariaLabel}
      >
        {filtered.map((o) => (
          <OptionRow
            key={o.id}
            option={o}
            active={value.includes(o.id)}
            lockedLast={requireOne && value.includes(o.id) && value.length <= 1}
            lockedReason={frozen?.[o.id] ?? (value.includes(o.id) ? locked?.[o.id] : undefined)}
            onToggle={toggle}
          />
        ))}
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-muted">Không có vai trò</li>
        )}
        {moreHint && query === '' && (
          <li className="px-2 py-2 text-center text-xs text-faint">Gõ để tìm thêm</li>
        )}
      </ul>
    </>
  );
}

/** Một dòng checklist của RoleMultiSelect (nhãn, chấm màu, khoá khi là mục cuối bắt buộc). */
function OptionRow({
  option: o,
  active,
  lockedLast,
  lockedReason,
  onToggle,
}: {
  option: RoleOption;
  active: boolean;
  lockedLast: boolean;
  /** Không bỏ chọn được vì lý do nghiệp vụ: vẫn focus được (aria-disabled) để đọc lý do, bấm không làm gì. */
  lockedReason?: string;
  onToggle: (id: string) => void;
}) {
  const reasonId = useId();
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        aria-disabled={lockedReason ? true : undefined}
        aria-describedby={lockedReason ? reasonId : undefined}
        disabled={lockedLast && !lockedReason}
        onClick={() => onToggle(o.id)}
        title={lockedLast && !lockedReason ? 'Cần ít nhất một vai trò' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2',
          active && 'bg-surface-2',
          lockedLast && !lockedReason && 'cursor-not-allowed opacity-60',
          lockedReason && 'cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
            active ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
          )}
          aria-hidden
        >
          {active && <Check className="h-3 w-3" />}
        </span>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: o.color || 'var(--faint)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate" title={roleHint(o.name)}>
            {roleLabel(o.name)}
          </span>
          {lockedReason && (
            <span id={reasonId} className="mt-0.5 flex items-start gap-1 text-xs text-muted">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {lockedReason}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
