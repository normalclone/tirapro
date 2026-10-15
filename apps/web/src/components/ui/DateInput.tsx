import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ClipboardEvent,
  type RefObject,
} from 'react';
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

const DATE_ERR = 'Ngày chưa đúng (dd/MM/yyyy)';
const RANGE_ERR = 'Ngày nằm ngoài khoảng cho phép';
const TIME_ERR = 'Giờ chưa đúng (HH:mm)';

/** Viền + ring đỏ kể cả khi đang focus (đè `focus-visible:border-primary` của `Input`). */
const INVALID_CLS = 'border-danger focus-visible:!border-danger focus-visible:ring-danger/40';

const CAN_PICK =
  typeof HTMLInputElement !== 'undefined' &&
  typeof HTMLInputElement.prototype.showPicker === 'function';

/** Thông điệp lỗi của chữ đang gõ ('' nếu trống hoặc hợp lệ). */
function dateError(text: string, min?: string, max?: string): string {
  if (text === '') return '';
  const iso = parseViDate(text);
  if (iso === null) return DATE_ERR;
  return inDateRange(iso, min, max) ? '' : RANGE_ERR;
}

/**
 * Đặt `customValidity` của ô theo lỗi hiện có → form native không gửi đi giá trị cũ khi ô đang hiện chữ sai
 * (kể cả ô không `required`). Phần tử mang `data-custom-validity` nên `installViValidation` (U3) không xoá/đè.
 */
function useCustomValidity(ref: RefObject<HTMLInputElement | null>, msg: string) {
  useEffect(() => {
    ref.current?.setCustomValidity(msg);
  }, [ref, msg]);
}

/** `onCommit` không bắn trùng cùng một giá trị trong một lượt focus (Enter + blur, chọn lịch + blur). */
function useCommitOnce(onCommit?: (iso: string) => void) {
  const last = useRef<string | null>(null);
  return {
    commit: (iso: string) => {
      if (!onCommit || last.current === iso) return;
      last.current = iso;
      onCommit(iso);
    },
    reset: () => {
      last.current = null;
    },
  };
}

function isInside(e: FocusEvent<HTMLElement>): boolean {
  return e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget);
}

/**
 * Ô nhập ngày hiển thị/gõ theo `dd/MM/yyyy` (thay cho `<input type="date">` theo locale trình duyệt).
 * Giá trị vào/ra là ISO `yyyy-MM-dd` ('' = trống) nên API/form hiện có không đổi. Nút lịch chỉ để CHỌN
 * (lịch hệ điều hành qua `showPicker`); chữ hiển thị luôn là dd/MM/yyyy.
 *
 * Chữ sai/dở dang KHÔNG gọi `onChange`; ô hiện viền đỏ + `aria-invalid` + dòng "Ngày chưa đúng (dd/MM/yyyy)"
 * (khi đã gõ đủ hoặc rời ô) và giữ nguyên chữ để người dùng sửa (không âm thầm quay về giá trị cũ).
 * Trong lúc còn lỗi, ô đặt `customValidity` nên form native chặn gửi.
 */
export interface DateInputProps {
  value: string;
  onChange: (iso: string) => void;
  /**
   * Gọi khi focus rời khỏi ô (hoặc Enter / chọn từ lịch) — cho ô sửa-tại-chỗ lưu khi mất focus.
   * Không gọi khi chữ đang sai; không gọi trùng cùng giá trị trong một lượt focus.
   */
  onCommit?: (iso: string) => void;
  /** Báo thông điệp lỗi hiện tại ('' = hợp lệ) — để `DateTimeInput` chặn commit. */
  onErrorChange?: (error: string) => void;
  id?: string;
  ariaLabel?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DateInput({
  value,
  onChange,
  onCommit,
  onErrorChange,
  id,
  ariaLabel,
  min,
  max,
  required,
  disabled,
  className,
}: DateInputProps) {
  const [text, setText] = useState(() => formatViDate(value));
  const [touched, setTouched] = useState(false);
  const latest = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const errId = useId();
  const once = useCommitOnce(onCommit);

  // Đồng bộ khi giá trị đổi từ ngoài (reset form, mở bản ghi khác…).
  useEffect(() => {
    latest.current = value;
    setText(formatViDate(value));
    setTouched(false);
  }, [value]);

  const err = dateError(text, min, max);
  const showErr = err !== '' && (touched || text.length === 10);
  useCustomValidity(inputRef, err);
  useEffect(() => onErrorChange?.(err), [err, onErrorChange]);

  const apply = (iso: string) => {
    latest.current = iso;
    setText(formatViDate(iso));
    setTouched(false);
    onChange(iso);
  };

  /** Chữ đang gõ hợp lệ (vd `05/08/26`) → chuẩn hoá + báo lên; sai → giữ nguyên, hiện lỗi. */
  const settle = (): boolean => {
    if (text === '') return true;
    const iso = parseViDate(text);
    if (iso !== null && inDateRange(iso, min, max)) {
      if (iso !== latest.current || text !== formatViDate(iso)) apply(iso);
      return true;
    }
    setTouched(true);
    return false;
  };

  const handleText = (raw: string) => {
    const masked = maskViDate(raw);
    setText(masked);
    setTouched(false);
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

  const openPicker = () => {
    try {
      pickerRef.current?.showPicker();
    } catch {
      /* trình duyệt từ chối (không có tương tác người dùng) — vẫn gõ tay được */
    }
  };

  return (
    <div
      className="relative"
      onFocus={once.reset}
      onBlur={(e) => {
        if (isInside(e)) return;
        if (settle()) once.commit(latest.current);
      }}
    >
      <Input
        ref={inputRef}
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
        aria-invalid={showErr || undefined}
        aria-describedby={showErr ? errId : undefined}
        data-custom-validity=""
        className={cn(CAN_PICK && 'pr-10', showErr && INVALID_CLS, className)}
        onChange={(e) => handleText(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && settle()) once.commit(latest.current);
        }}
      />
      {CAN_PICK && (
        <>
          <button
            type="button"
            aria-label="Chọn ngày từ lịch"
            disabled={disabled}
            // Không để nút nhận focus: Safari không focus button → relatedTarget=null làm blur giả, bắn commit sớm.
            onMouseDown={(e) => {
              e.preventDefault();
              inputRef.current?.focus();
            }}
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
              once.commit(e.target.value);
            }}
          />
        </>
      )}
      {showErr && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

/**
 * Ngày + giờ: `DateInput` + ô giờ `HH:mm` 24h (không dùng `type="time"` vì ra AM/PM ở locale en-US).
 * Giá trị `yyyy-MM-ddTHH:mm` giờ địa phương ('' = trống). Chọn ngày mà giờ trống → `defaultTime`.
 * Xoá trống ô giờ rồi rời ô → hiển thị khôi phục giờ đang có trong `value` (không bao giờ hiện trống mà vẫn gửi giờ cũ).
 * Giờ sai/dở dang: viền đỏ + dòng "Giờ chưa đúng (HH:mm)" + `customValidity`, giữ chữ để sửa.
 */
export interface DateTimeInputProps extends Omit<
  DateInputProps,
  'min' | 'max' | 'onCommit' | 'onErrorChange'
> {
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
  const [timeTouched, setTimeTouched] = useState(false);
  const [dateErr, setDateErr] = useState('');
  const latest = useRef(value);
  const timeRef = useRef<HTMLInputElement>(null);
  const errId = useId();
  const once = useCommitOnce(onCommit);

  useEffect(() => {
    latest.current = value;
    setTimeText(splitDateTime(value).time);
    setTimeTouched(false);
  }, [value]);

  const timeErr = timeText !== '' && parseViTime(timeText) === null ? TIME_ERR : '';
  const showTimeErr = timeErr !== '' && (timeTouched || timeText.length === 5);
  useCustomValidity(timeRef, timeErr);

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
    setTimeTouched(false);
    const t = parseViTime(masked);
    if (t !== null && masked.length === 5 && split.date) emit(joinDateTime(split.date, t));
  };

  /** Rời ô giờ: trống → khôi phục giờ trong value; sai → giữ chữ + hiện lỗi. */
  const settleTime = (): boolean => {
    if (timeText === '') {
      if (split.date) setTimeText(split.time);
      return true;
    }
    if (timeErr) {
      setTimeTouched(true);
      return false;
    }
    return true;
  };

  const tryCommit = () => {
    if (dateErr || timeErr) return;
    once.commit(latest.current);
  };

  return (
    <div
      className={className}
      onFocus={once.reset}
      onBlur={(e) => {
        if (isInside(e)) return;
        if (settleTime()) tryCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && settleTime()) tryCommit();
      }}
    >
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <DateInput
            id={id}
            ariaLabel={ariaLabel ?? 'Ngày'}
            value={split.date}
            onChange={handleDate}
            onErrorChange={setDateErr}
            required={required}
            disabled={disabled}
          />
        </div>
        <Input
          ref={timeRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="HH:mm"
          maxLength={5}
          aria-label={ariaLabel ? `${ariaLabel} — giờ` : 'Giờ'}
          aria-invalid={showTimeErr || undefined}
          aria-describedby={showTimeErr ? errId : undefined}
          data-custom-validity=""
          value={timeText}
          disabled={disabled || !split.date}
          className={cn('w-20 shrink-0 text-center', showTimeErr && INVALID_CLS)}
          onChange={(e) => handleTime(e.target.value)}
          onBlur={() => {
            if (timeText === '' && split.date) setTimeText(split.time);
            else if (timeErr) setTimeTouched(true);
          }}
        />
      </div>
      {showTimeErr && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          {timeErr}
        </p>
      )}
    </div>
  );
}
