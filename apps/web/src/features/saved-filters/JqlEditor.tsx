import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { suggestJql, type JqlCatalog, type JqlSuggestion } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { useProjects } from '@/features/projects/api';
import { cn } from '@/lib/utils';
import { useFilterFields, useJqlValidation, type JqlValidation } from './api';
import { applyDidYouMean, applySuggestion } from './jqlEditorModel';

const KIND_LABEL: Record<JqlSuggestion['kind'], string> = {
  field: 'Trường',
  operator: 'Toán tử',
  value: 'Giá trị',
  keyword: 'Từ khoá',
  function: 'Hàm',
};

/** Danh mục giá trị thật của workspace cho `suggestJql` (đọc từ `/search/fields` + danh sách dự án đã tải). */
function useJqlCatalog(): JqlCatalog {
  const { data: fields } = useFilterFields();
  const { data: projects } = useProjects();
  return useMemo(() => {
    const names = (xs: { value: string }[] | undefined) => (xs ?? []).map((x) => x.value);
    return {
      statuses: names(fields?.statuses),
      types: names(fields?.types),
      priorities: names(fields?.priorities),
      severities: names(fields?.severities),
      sprints: names(fields?.sprints),
      labels: names(fields?.labels),
      resolutions: names(fields?.resolutions),
      components: names(fields?.components),
      versions: names(fields?.versions),
      projects: (projects ?? []).map((p) => p.key),
    };
  }, [fields, projects]);
}

/**
 * Ô nhập JQL có gợi ý tự hoàn thành (combobox ARIA tự dựng — Radix Popover sẽ cướp focus khỏi ô khi gõ) và
 * báo lỗi cú pháp / giá trị sai ngay dưới ô (kèm nút "Dùng …" cho "ý bạn là …"). Không chặn việc chạy truy vấn.
 *
 * Phím: ↑↓ chọn · Tab/Enter chấp nhận mục đang chọn (không có mục chọn: Tab đi tiếp, Enter chạy) · Esc đóng gợi ý (không đóng hộp thoại cha) · Ctrl+Space mở ·
 * Cmd/Ctrl+Enter chạy (`onRun`).
 */
export function JqlEditor({
  value,
  onChange,
  onRun,
  rows = 2,
  id,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  rows?: number;
  id?: string;
  placeholder?: string;
  /** Nhãn cho trình đọc màn hình (ô không có nhãn hiển thị). */
  label?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `jql-${autoId}`;
  const listId = `${inputId}-list`;
  const catalog = useJqlCatalog();
  const { validation } = useJqlValidation(value);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  // null = chưa chọn tay: mặc định chọn mục đầu CHỈ khi người dùng đang gõ dở một từ.
  const [active, setActive] = useState<number | null>(null);

  const result = useMemo(
    () => (open ? suggestJql(value, caret, catalog) : null),
    [open, value, caret, catalog],
  );
  const items = result?.items ?? [];
  const expanded = open && items.length > 0;
  const defaultIndex = result && result.from < result.to ? 0 : -1;
  // -1 = không mục nào được chọn → Tab/Enter không nhận gợi ý (Tab ra khỏi ô, Enter chạy truy vấn).
  const activeIndex =
    active === null ? defaultIndex : Math.min(active, Math.max(0, items.length - 1));

  // Sau khi áp gợi ý, đặt lại con trỏ khi React đã cập nhật giá trị của ô.
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !areaRef.current) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    areaRef.current.setSelectionRange(pos, pos);
    setCaret(pos);
  }, [value]);

  useEscapeCloses(expanded, () => setOpen(false));

  function syncCaret() {
    if (areaRef.current) setCaret(areaRef.current.selectionStart);
  }

  function accept(item: JqlSuggestion) {
    if (!result) return;
    const next = applySuggestion(value, result, item);
    setActive(null);
    if (next.text === value) {
      areaRef.current?.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    } else {
      pendingCaret.current = next.caret;
      onChange(next.text);
    }
    areaRef.current?.focus();
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    setCaret(e.target.selectionStart);
    setActive(null);
    setOpen(true);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      syncCaret();
      setActive(null);
      setOpen(true);
      return;
    }
    const plainKey = !e.shiftKey && !e.nativeEvent.isComposing;
    if (expanded && e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % items.length);
    } else if (expanded && e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (expanded && activeIndex >= 0 && plainKey && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      accept(items[activeIndex]!);
    } else if (e.key === 'Enter' && plainKey && onRun) {
      // Không có gợi ý được chọn: Enter chạy truy vấn (JQL một dòng; Shift+Enter xuống dòng).
      e.preventDefault();
      onRun();
    }
  }

  const invalid = validation && !validation.valid ? validation : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        {label && (
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
        )}
        <textarea
          ref={areaRef}
          id={inputId}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={syncCaret}
          onBlur={() => setOpen(false)}
          rows={rows}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-invalid={invalid ? true : undefined}
          className={cn(
            'w-full resize-y rounded-md border bg-bg px-3 py-2 font-mono text-sm text-ink',
            'placeholder:text-faint transition-colors duration-150',
            'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            invalid ? 'border-danger/60' : 'border-border',
          )}
        />
        {expanded && (
          <SuggestionList
            id={listId}
            items={items}
            activeIndex={activeIndex}
            onHover={setActive}
            onAccept={accept}
          />
        )}
      </div>

      <ValidationNotice validation={invalid} value={value} onChange={onChange} />
    </div>
  );
}

function SuggestionList({
  id,
  items,
  activeIndex,
  onHover,
  onAccept,
}: {
  id: string;
  items: JqlSuggestion[];
  activeIndex: number;
  onHover: (i: number) => void;
  onAccept: (item: JqlSuggestion) => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Gợi ý JQL"
      className="absolute inset-x-0 top-full z-dropdown mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
    >
      {items.map((item, i) => (
        <li
          key={`${item.kind}:${item.insert}`}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          // mousedown (không phải click) + preventDefault để ô không mất focus trước khi chọn
          onMouseDown={(e) => {
            e.preventDefault();
            onAccept(item);
          }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm',
            i === activeIndex ? 'bg-primary-subtle text-primary' : 'text-ink',
          )}
        >
          <span className="shrink-0 font-mono">{item.label}</span>
          {item.detail && (
            <span className="min-w-0 truncate text-xs text-muted">{item.detail}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-faint">{KIND_LABEL[item.kind]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lỗi cú pháp / giá trị sai của câu JQL kèm nút "Dùng …" cho "ý bạn là …". Luôn có vùng aria-live để đọc khi lỗi xuất hiện. */
function ValidationNotice({
  validation,
  value,
  onChange,
}: {
  validation: JqlValidation | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const fixes = (validation?.suggestions ?? []).filter((s) => s.didYouMean);
  return (
    <div aria-live="polite">
      {validation && (
        <div className="flex flex-col gap-1.5 rounded-md border border-danger/40 bg-surface-2 px-3 py-2 text-sm text-danger">
          <p>
            {validation.error}
            {validation.position !== undefined && (
              <span className="text-muted"> (tại ký tự {validation.position + 1})</span>
            )}
          </p>
          {fixes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {fixes.map((s) => (
                <Button
                  key={`${s.field}:${s.value}`}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onChange(applyDidYouMean(value, s.field, s.value, s.didYouMean!))}
                >
                  Dùng “{s.didYouMean}”
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Esc khi gợi ý đang mở chỉ đóng gợi ý: bắt ở window (capture) để chặn trước lớp Dialog của Radix (nghe ở document). */
function useEscapeCloses(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!active) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [active]);
}
