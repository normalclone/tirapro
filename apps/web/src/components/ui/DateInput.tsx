import { useEffect, useRef, useState, type ClipboardEvent, type FocusEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  formatViDate,
  inDateRange,
  joinDateTime,
  maskViDate,
  maskViTime,
  parseViDate,
  parseViTime,
  splitDateTime,
} from '@/lib/dateInput';

/**
 * Ô nhập ngày hiển thị/gõ theo `dd/MM/yyyy` (thay cho `<input type="date">` theo locale trình duyệt).
 * Giá trị vào/ra là ISO `yyyy-MM-dd` ('' = trống) nên API/form hiện có không đổi. Nút lịch chỉ để CHỌN
 * (lịch hệ điều hành qua `showPicker`); chữ hiển thị luôn là dd/MM/yyyy.
 */
export interface DateInputProps {
  value: string;
  onChange: (iso: string) => void;
  /** Gọi khi focus rời khỏi ô (hoặc Enter / chọn từ lịch) — cho ô sửa-tại-chỗ lưu khi mất focus. */
  onCommit?: (iso: string) => void;
  id?: string;
  ariaLabel?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

const CAN_PICK =
  typeof HTMLInputElement !== 'undefined' &&
  typeof HTMLInputElement.prototype.showPicker === 'function';

function isValidText(text: string, min?: string, max?: string): boolean {
  const iso = parseViDate(text);
  return iso !== null && inDateRange(iso, min, max);
}

export function DateInput({
  value,
  onChange,
  onCommit,
  id,
  ariaLabel,
  min,
  max,
  required,
  disabled,
  className,
}: DateInputProps) {
  const [text, setText] = useState(() => formatViDate(value));
  const latest = useRef(value);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Đồng bộ khi giá trị đổi từ ngoài (reset form, mở bản ghi khác…).
  useEffect(() => {
    latest.current = value;
    setText(formatViDate(value));
  }, [value]);

  const apply = (iso: string) => {
    latest.current = iso;
    setText(formatViDate(iso));
    onChange(iso);
  };

  const handleText = (raw: string) => {
    const masked = maskViDate(raw);
    setText(masked);
    if (masked === '') {
      latest.current = '';
      onChange('');
      return;
    }
    const iso = parseViDate(masked);
    if (masked.length === 10 && iso !== null && inDateRange(iso, min, max)) {
      latest.current = iso;
      onChange(iso);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const iso = parseViDate(e.clipboardData.getData('text'));
    if (iso !== null && inDateRange(iso, min, max)) {
      e.preventDefault();
      apply(iso);
    }
  };

  const handleBlur = () => {
    // Sai/chưa đủ → trả ô về giá trị hợp lệ gần nhất, không xoá âm thầm dữ liệu.
    if (text !== '' && !isValidText(text, min, max)) setText(formatViDate(latest.current));
  };

  const handleContainerBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!onCommit) return;
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    onCommit(latest.current);
  };

  const invalid = text !== '' && !isValidText(text, min, max);

  const openPicker = () => {
    try {
      pickerRef.current?.showPicker();
    } catch {
      /* trình duyệt từ chối (không có tương tác người dùng) — vẫn gõ tay được */
    }
  };

  return (
    <div className="relative" onBlur={handleContainerBlur}>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        value={text}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(CAN_PICK && 'pr-10', invalid && 'border-danger', className)}
        onChange={(e) => handleText(e.target.value)}
        onPaste={handlePaste}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit?.(latest.current);
        }}
      />
      {CAN_PICK && (
        <>
          <button
            type="button"
            aria-label="Chọn ngày từ lịch"
            disabled={disabled}
            onClick={openPicker}
            className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
          </button>
          <input
            ref={pickerRef}
            type="date"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            value={value}
            min={min}
            max={max}
            onChange={(e) => {
              if (!e.target.value) return;
              apply(e.target.value);
              onCommit?.(e.target.value);
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Ngày + giờ: `DateInput` + ô giờ `HH:mm` 24h (không dùng `type="time"` vì ra AM/PM ở locale en-US).
 * Giá trị `yyyy-MM-ddTHH:mm` giờ địa phương ('' = trống). Chọn ngày mà giờ trống → `defaultTime`.
 */
export interface DateTimeInputProps extends Omit<DateInputProps, 'min' | 'max' | 'onCommit'> {
  onCommit?: (isoLocal: string) => void;
  /** Giờ mặc định khi vừa chọn ngày mà chưa có giờ (mặc định 17:00 = cuối giờ làm việc). */
  defaultTime?: string;
}

export function DateTimeInput({
  value,
  onChange,
  onCommit,
  defaultTime = '17:00',
  id,
  ariaLabel,
  required,
  disabled,
  className,
}: DateTimeInputProps) {
  const split = splitDateTime(value);
  const [timeText, setTimeText] = useState(split.time);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
    setTimeText(splitDateTime(value).time);
  }, [value]);

  const emit = (next: string) => {
    latest.current = next;
    onChange(next);
  };

  const handleDate = (iso: string) => {
    if (!iso) {
      setTimeText('');
      emit('');
      return;
    }
    const time = parseViTime(timeText) ?? parseViTime(defaultTime) ?? '00:00';
    setTimeText(time);
    emit(joinDateTime(iso, time));
  };

  const handleTime = (raw: string) => {
    const masked = maskViTime(raw);
    setTimeText(masked);
    const t = parseViTime(masked);
    if (t !== null && masked.length === 5 && split.date) emit(joinDateTime(split.date, t));
  };

  const timeInvalid = timeText !== '' && parseViTime(timeText) === null;

  return (
    <div
      className={cn('flex gap-2', className)}
      onBlur={(e) => {
        if (!onCommit) return;
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        onCommit(latest.current);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.(latest.current);
      }}
    >
      <div className="min-w-0 flex-1">
        <DateInput
          id={id}
          ariaLabel={ariaLabel ?? 'Ngày'}
          value={split.date}
          onChange={handleDate}
          required={required}
          disabled={disabled}
        />
      </div>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        maxLength={5}
        aria-label={ariaLabel ? `${ariaLabel} — giờ` : 'Giờ'}
        aria-invalid={timeInvalid || undefined}
        value={timeText}
        disabled={disabled || !split.date}
        className={cn('w-20 shrink-0 text-center', timeInvalid && 'border-danger')}
        onChange={(e) => handleTime(e.target.value)}
        onBlur={() => {
          // Sai/chưa đủ → trả về giờ hợp lệ gần nhất.
          if (timeText !== '' && parseViTime(timeText) === null)
            setTimeText(splitDateTime(latest.current).time);
          else if (timeText !== '' && split.date) {
            const t = parseViTime(timeText);
            if (t && t !== split.time) emit(joinDateTime(split.date, t));
          }
        }}
      />
    </div>
  );
}
