import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { FieldErrorText } from '@/components/ui/FieldError';
import { Input } from '@/components/ui/Input';
import { INVALID_FIELD_CLS, invalidAttrs } from '@/lib/formErrors';
import { groupHeadingAt } from './searchSelectGroups';
import {
  filterOptions,
  focusTarget,
  nextActiveIndex,
  shouldShowSearch,
  typeaheadIndex,
} from './searchSelectNav';
import { shouldEmitChange } from '@/lib/radioNav';
import { cn } from '@/lib/utils';

const TYPEAHEAD_MS = 600;

export interface SearchSelectOption {
  value: string;
  label: string;
  color?: string | null;
  /** Nội dung phụ bên phải (vd: key issue, mã). */
  hint?: string;
  /** Huy hiệu chữ thường (không mono) bên phải — vd mức chia sẻ của dashboard. */
  badge?: string;
  /** Dòng thứ hai (chữ nhỏ, mờ) dưới nhãn — được tìm; vẫn hiện ở mục disabled (vd lý do không chọn được). */
  description?: string;
  /** Biểu tượng trước nhãn; thay chấm `color` nếu có cả hai. */
  icon?: ReactNode;
  /** Không chọn được (hiện mờ, kèm `hint` giải thích nếu có). */
  disabled?: boolean;
  /** Tiêu đề nhóm: hiện một hàng tiêu đề (không chọn được) trước lựa chọn đầu tiên của mỗi nhóm liên tiếp. */
  group?: string;
}

/**
 * Dropdown chọn-một CÓ Ô TÌM KIẾM — thay cho ô chọn native (thẻ select) khi danh sách >5 lựa chọn
 * hoặc số lượng không xác định (data động: người dùng, dự án, trạng thái…).
 *
 * Dùng như select: truyền `value` (chuỗi), `onChange(value)`, và `options`.
 * Lựa chọn rỗng (vd "Chưa gán") chỉ cần là một option `{ value: '', label: 'Chưa gán' }`.
 * Chọn lại giá trị đang chọn KHÔNG phát `onChange` (như select native, xem `shouldEmitChange`): menu dạng "hành động"
 * phải truyền `value=""` và để mọi option có `value` khác rỗng thì mới luôn phát.
 */
const TRIGGER_CLS = [
  'flex h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-3 text-left text-sm transition-colors',
  'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
  'disabled:bg-disabled-bg disabled:text-disabled-fg disabled:cursor-not-allowed data-[state=open]:border-primary',
].join(' ');

function TriggerLabel({
  selected,
  placeholder,
  renderTrigger,
}: {
  selected: SearchSelectOption | undefined;
  placeholder: string;
  renderTrigger?: (selected: SearchSelectOption | undefined) => ReactNode;
}) {
  if (renderTrigger)
    return <span className="min-w-0 flex-1 truncate">{renderTrigger(selected)}</span>;
  return (
    <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-ink' : 'text-faint')}>
      {selected ? selected.label : placeholder}
    </span>
  );
}

function SearchSelectControl({
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
  hideChevron,
  onSearchChange,
  moreHint,
  resolveOption,
  searchable,
  invalidAria,
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
  /** Bỏ mũi tên (trigger gọn dạng chấm/biểu tượng, vd chấm ưu tiên trên dòng Việc chờ). */
  hideChevron?: boolean;
  /** Tìm phía máy chủ: báo từ khoá gõ (nơi gọi debounce rồi nạp lại `options`). Bỏ trống = chỉ lọc tại chỗ. */
  onSearchChange?: (q: string) => void;
  /** Danh sách đã đầy mà chưa gõ → hiện dòng "Gõ để tìm thêm". */
  moreHint?: boolean;
  /** Tra lựa chọn đang chọn khi nó không nằm trong `options` (kết quả tìm đã bị lọc). */
  resolveOption?: (value: string) => SearchSelectOption | undefined;
  /** Ép hiện/ẩn ô tìm. Mặc định: hiện khi > 6 mục hoặc có `onSearchChange` (tìm phía máy chủ). */
  searchable?: boolean;
  /** Thuộc tính aria của lỗi (từ `invalidAttrs`); có `aria-invalid` thì trigger viền danger. */
  invalidAria?: { 'aria-invalid'?: true; 'aria-describedby'?: string };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? shouldShowSearch(options.length, !!onSearchChange);

  const selected =
    options.find((o) => o.value === value) ?? (value ? resolveOption?.(value) : undefined);
  // Không phân biệt hoa thường/dấu, tìm theo nhãn + mã hiển thị (`hint`) + `description`, KHÔNG theo `value` (id nội bộ).
  const filtered = filterOptions(options, q);

  const { activeIndex, setActive, source, onNavKeyDown } = useActiveOption({
    open,
    q,
    value,
    items: filtered,
    typeahead: !showSearch,
    onPick: (v) => pick(v),
  });

  const focusSearchOrList = useFocusFollowsSearch(open, showSearch, inputRef, listRef);

  useClearQueryWhenSearchHidden(showSearch, setQ);

  function resetSearch() {
    setQ('');
    onSearchChange?.('');
  }

  function pick(v: string) {
    // Như ô chọn native: chọn lại mục đang chọn KHÔNG phát onChange (nhiều nơi reset dữ liệu khi giá trị đổi).
    // Menu dạng "hành động" dùng `value=""` + option khác rỗng nên vẫn luôn phát.
    if (shouldEmitChange(value, v)) onChange(v);
    setOpen(false);
    resetSearch();
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetSearch();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          {...invalidAria}
          className={cn(TRIGGER_CLS, invalidAria?.['aria-invalid'] && INVALID_FIELD_CLS, className)}
        >
          <TriggerLabel
            selected={selected}
            placeholder={placeholder}
            renderTrigger={renderTrigger}
          />
          {!hideChevron && <ChevronDown className="h-4 w-4 shrink-0 text-faint" aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className="z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // Focus vào ô tìm (nếu có) hoặc vào listbox — không để Radix chọn phần tử đầu tiên.
            e.preventDefault();
            focusSearchOrList();
          }}
        >
          {showSearch && (
            <SearchBox
              inputRef={inputRef}
              listId={listId}
              activeId={filtered[activeIndex] ? optionId(activeIndex) : undefined}
              placeholder={searchPlaceholder}
              value={q}
              onChange={(v) => {
                setQ(v);
                onSearchChange?.(v);
              }}
              onKeyDown={onNavKeyDown}
            />
          )}
          <ul
            ref={listRef}
            id={listId}
            className="group max-h-64 overflow-y-auto p-1 outline-none"
            role="listbox"
            aria-label={ariaLabel ?? placeholder}
            tabIndex={showSearch ? undefined : 0}
            onMouseDown={(e) => e.preventDefault()}
            aria-activedescendant={
              !showSearch && filtered[activeIndex] ? optionId(activeIndex) : undefined
            }
            onKeyDown={showSearch ? undefined : onNavKeyDown}
          >
            <OptionRows
              items={filtered}
              value={value}
              activeIndex={activeIndex}
              source={source}
              optionId={optionId}
              onHover={(i) => setActive(i, 'mouse')}
              onPick={pick}
              showMoreHint={!!moreHint && q.trim() === ''}
            />
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Ô tìm của SearchSelect, theo mẫu ARIA combobox: focus ở ô, mục đang trỏ báo qua `aria-activedescendant`. */
function SearchBox({
  inputRef,
  listId,
  activeId,
  placeholder,
  value,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement>;
  listId: string;
  activeId: string | undefined;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <div className="border-b border-border p-2">
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm max-sm:text-[16px]"
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** Ô tìm ẩn đi lúc đang mở (danh sách co lại ≤ ngưỡng): xoá từ khoá, kẻo bộ lọc ẩn vẫn che mất lựa chọn. */
function useClearQueryWhenSearchHidden(showSearch: boolean, setQ: (q: string) => void) {
  useEffect(() => {
    if (!showSearch) setQ('');
  }, [showSearch, setQ]);
}

/**
 * Focus vào ô tìm (nếu có) hoặc listbox. Ô tìm hiện/ẩn khi đang mở (options nạp muộn vượt/giảm dưới ngưỡng) thì focus
 * chuyển theo, không để rơi ra body. Trả hàm focus để dùng cho lúc mở.
 */
function useFocusFollowsSearch(
  open: boolean,
  showSearch: boolean,
  inputRef: RefObject<HTMLInputElement>,
  listRef: RefObject<HTMLUListElement>,
) {
  const prev = useRef(showSearch);
  const focusNow = () =>
    (focusTarget(showSearch) === 'input' ? inputRef.current : listRef.current)?.focus({
      preventScroll: true,
    });
  useEffect(() => {
    const changed = prev.current !== showSearch;
    prev.current = showSearch;
    if (open && changed) focusNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng khi showSearch đổi lúc đang mở
  }, [open, showSearch]);
  return focusNow;
}

type ActiveSource = 'init' | 'key' | 'mouse';

/**
 * Mục đang trỏ + bàn phím của danh sách. Mở ra → trỏ mục đang chọn nếu còn thấy, không thì mục bật đầu tiên; gõ lọc →
 * mục bật đầu tiên. `typeahead` (không có ô tìm): gõ chữ cái nhảy tới mục, gom ký tự trong 600ms.
 * `source`: 'key' = bàn phím (vẽ viền focus), 'mouse' = rê chuột (không tự cuộn), 'init' = vừa mở/lọc.
 */
function useActiveOption({
  open,
  q,
  value,
  items,
  typeahead,
  onPick,
}: {
  open: boolean;
  q: string;
  value: string;
  items: SearchSelectOption[];
  typeahead: boolean;
  onPick: (value: string) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [source, setSource] = useState<ActiveSource>('init');
  const typed = useRef({ text: '', at: 0 });
  const listKey = items.map((o) => o.value).join('\u0001');

  useEffect(() => {
    if (!open) return;
    const firstEnabled = items.findIndex((o) => !o.disabled);
    const selectedAt = q.trim() ? -1 : items.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(selectedAt >= 0 ? selectedAt : firstEnabled);
    setSource('init');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ tính lại khi mở/đổi từ khoá/đổi danh sách hiện
  }, [open, q, listKey]);

  const setActive = (i: number, src: ActiveSource) => {
    setActiveIndex(i);
    setSource(src);
  };

  function onNavKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.nativeEvent.isComposing) return;
    const next = nextActiveIndex(items, activeIndex, e.key);
    if (next !== null) {
      e.preventDefault();
      if (next >= 0) setActive(next, 'key');
      return;
    }
    const t = typed.current;
    const buffering = Date.now() - t.at < TYPEAHEAD_MS;
    if (e.key === 'Enter' || (typeahead && e.key === ' ' && !buffering)) {
      e.preventDefault();
      const cur = items[activeIndex];
      if (cur && !cur.disabled) onPick(cur.value);
      return;
    }
    if (!typeahead || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    t.text = buffering ? t.text + e.key : e.key;
    t.at = Date.now();
    // Lặp một chữ (cc…) → lần lượt qua các mục cùng chữ; nhiều chữ khác nhau → mục khớp tiền tố, tính cả mục hiện tại.
    const cycling = t.text.length > 1 && [...t.text].every((c) => c === t.text[0]);
    const idx = cycling
      ? typeaheadIndex(items, t.text[0] as string, activeIndex)
      : typeaheadIndex(items, t.text, t.text.length > 1 ? activeIndex - 1 : activeIndex);
    if (idx >= 0) setActive(idx, 'key');
  }

  return { activeIndex, setActive, source, onNavKeyDown };
}

/** Các dòng của listbox: tiêu đề nhóm, lựa chọn, "Không có lựa chọn" và gợi ý "Gõ để tìm thêm". */
function OptionRows({
  items,
  value,
  activeIndex,
  source,
  optionId,
  onHover,
  onPick,
  showMoreHint,
}: {
  items: SearchSelectOption[];
  value: string;
  activeIndex: number;
  source: ActiveSource;
  optionId: (i: number) => string;
  onHover: (i: number) => void;
  onPick: (value: string) => void;
  showMoreHint: boolean;
}) {
  return (
    <>
      {items.map((o, i) => {
        const heading = groupHeadingAt(items, i);
        return (
          <Fragment key={o.value || '__empty__'}>
            {heading && (
              <li
                role="presentation"
                className="px-2 pb-1 pt-2 text-xs font-medium text-muted first:pt-1"
              >
                {heading}
              </li>
            )}
            <OptionRow
              id={optionId(i)}
              option={o}
              selected={o.value === value}
              active={i === activeIndex}
              source={source}
              onHover={() => {
                if (!o.disabled) onHover(i);
              }}
              onPick={onPick}
            />
          </Fragment>
        );
      })}
      {items.length === 0 && (
        <li className="px-2 py-3 text-center text-sm text-muted">Không có lựa chọn</li>
      )}
      {showMoreHint && <li className="px-2 py-2 text-center text-xs text-faint">Gõ để tìm thêm</li>}
    </>
  );
}

/** Một dòng lựa chọn của SearchSelect (icon/chấm màu, nhãn + mô tả, mã `hint`, huy hiệu `badge`). Không là tab stop: focus ở ô tìm/listbox. */
function OptionRow({
  id,
  option: o,
  selected,
  active,
  source,
  onHover,
  onPick,
}: {
  id: string;
  option: SearchSelectOption;
  selected: boolean;
  active: boolean;
  source: ActiveSource;
  onHover: () => void;
  onPick: (value: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active && source !== 'mouse') ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active, source]);
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={o.disabled || undefined}
      onClick={() => {
        if (!o.disabled) onPick(o.value);
      }}
      onMouseMove={active ? undefined : onHover}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors',
        o.description && 'items-start',
        !o.disabled && 'cursor-pointer',
        (active || selected) && 'bg-surface-2',
        active && source === 'key' && 'ring-2 ring-inset ring-[var(--ring)]',
        // Danh sách không có ô tìm: focus nằm ở <ul>, nên hàng đang trỏ vẽ viền khi ul focus-visible (mở bằng bàn phím); mở bằng chuột thì không.
        active &&
          'group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-[var(--ring)]',
        o.disabled && 'cursor-not-allowed text-muted',
      )}
    >
      <Check
        className={cn(
          'h-4 w-4 shrink-0 text-primary',
          o.description && 'mt-0.5',
          selected ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />
      {o.icon ? (
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center',
            o.description && 'mt-0.5',
          )}
          aria-hidden
        >
          {o.icon}
        </span>
      ) : (
        o.color && (
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', o.description && 'mt-1.5')}
            style={{ background: o.color }}
            aria-hidden
          />
        )
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{o.label}</span>
        {o.description && (
          <span className="block truncate text-xs text-muted">{o.description}</span>
        )}
      </span>
      {o.hint && <span className="shrink-0 font-mono text-xs text-faint">{o.hint}</span>}
      {o.badge && (
        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          {o.badge}
        </span>
      )}
    </li>
  );
}

type SearchSelectProps = Parameters<typeof SearchSelectControl>[0];

/**
 * Như `SearchSelectControl` + `invalid`: `true` → viền danger + aria-invalid; chuỗi → thêm lời lỗi dưới ô (id `<id>-error`,
 * nối vào aria-describedby, sau `aria-describedby` truyền vào). Chuỗi cần `id` để id lời lỗi ổn định và trùng với ô mà
 * `ErrorSummary`/`focusFirstError` tìm.
 * Lưu ý: chuỗi vẽ thêm một `<p>` ANH EM sau ô — trong khung `relative`/có icon hay trong `<label>` sẽ vỡ bố cục; khi đó dùng
 * `FormField` và truyền `invalid` boolean (FormField tự vẽ lời lỗi).
 */
export function SearchSelect({
  invalid,
  'aria-describedby': describedByProp,
  ...props
}: Omit<SearchSelectProps, 'invalidAria'> & {
  invalid?: boolean | string;
  'aria-describedby'?: string;
}) {
  const autoId = useId();
  const a = invalidAttrs(invalid, props.id ?? autoId, describedByProp);
  const control = (
    <SearchSelectControl
      {...props}
      invalidAria={{ 'aria-invalid': a.ariaInvalid, 'aria-describedby': a.describedBy }}
    />
  );
  if (!a.errorId) return control;
  return (
    <>
      {control}
      <FieldErrorText id={a.errorId}>{a.errorText}</FieldErrorText>
    </>
  );
}
