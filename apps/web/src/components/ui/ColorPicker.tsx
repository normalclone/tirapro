import { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { radioGroupKeyDownSkipDisabled, shouldEmitChange } from '@/lib/radioNav';
import {
  LABEL_PALETTE,
  findPaletteEntry,
  labelTone,
  paletteValue,
  type PaletteFormat,
} from '@/lib/labelPalette';
import { parseHex, parseOklch } from '@/lib/oklch';
import { cn } from '@/lib/utils';

/** Nhóm radio PHẢI có tên truy cập: nhãn chuỗi (`ariaLabel`) hoặc trỏ tới nhãn nhìn thấy (`ariaLabelledby`). */
export type ColorPickerLabel =
  | { ariaLabel: string; ariaLabelledby?: undefined }
  | { ariaLabelledby: string; ariaLabel?: undefined };

/** Tên truy cập của swatch cho màu đang lưu nhưng KHÔNG thuộc bảng màu (nhãn cũ). */
const CURRENT_COLOR_NAME = 'Màu hiện tại';

/**
 * Chọn một trong 8 màu của `LABEL_PALETTE` (radiogroup các swatch). Cùng quy ước `SegmentedControl`/`RadioCard`:
 * roving tabindex (MỘT điểm dừng Tab = màu đang chọn; chưa chọn → swatch đầu), mũi tên/Home/End chuyển chọn,
 * `aria-checked`, chỉ phát `onChange` khi chọn màu KHÁC.
 * - Tên truy cập = tên màu tiếng Việt ("Đỏ", "Xanh lá"…), không đọc mã hex. Đang chọn = viền + dấu tick (không chỉ màu).
 * - Swatch tô bằng token `--label-N` (đổi theo sáng/tối); giá trị phát ra: hex chữ thường (`format="hex"`, mặc định)
 *   hoặc chuỗi OKLCH của biến thể sáng (`format="oklch"`, vai trò) — đúng định dạng đang lưu, không migration.
 * - Giá trị hiện có nằm NGOÀI bảng màu (dữ liệu cũ) → thêm swatch "Màu hiện tại" đang chọn để mở rồi lưu form
 *   không âm thầm đổi màu; swatch này còn đó suốt lúc đang sửa để quay lại được.
 * - Swatch 28px, 44px khi `pointer: coarse`.
 */
export function ColorPicker({
  value,
  onChange,
  format = 'hex',
  disabled = false,
  className,
  id,
  'aria-describedby': describedBy,
  ...labelProps
}: ColorPickerLabel & {
  /** Màu đang lưu (null/'' = chưa chọn). */
  value: string | null | undefined;
  onChange: (value: string) => void;
  format?: PaletteFormat;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
}) {
  const autoId = useId();
  const ariaLabel = 'ariaLabel' in labelProps ? labelProps.ariaLabel : undefined;
  const ariaLabelledby = 'ariaLabelledby' in labelProps ? labelProps.ariaLabelledby : undefined;

  const current = typeof value === 'string' ? value.trim() : '';
  const matched = findPaletteEntry(current, format);
  const legacyNow = current !== '' && !matched ? current : null;
  // Nhớ màu cũ đã thấy: chọn sang màu khác rồi vẫn quay lại được màu cũ trong lúc form còn mở.
  const [kept, setKept] = useState<string | null>(legacyNow);
  useEffect(() => {
    if (legacyNow) setKept(legacyNow);
  }, [legacyNow]);
  const legacy = legacyNow ?? kept;

  const items = [
    ...LABEL_PALETTE.map((e, i) => ({
      value: paletteValue(e, format),
      name: e.name,
      fill: `var(--label-${i + 1})`,
      title: e.name,
    })),
    ...(legacy
      ? [
          {
            value: legacy,
            name: CURRENT_COLOR_NAME,
            // Màu cũ hiển thị đúng màu đã lưu; chuỗi không đọc được thì dùng tông Xám trung tính.
            fill: parseHex(legacy) || parseOklch(legacy) ? legacy : labelTone(legacy).fg,
            title: `${CURRENT_COLOR_NAME} (gần với ${labelTone(legacy).name})`,
          },
        ]
      : []),
  ];
  // Swatch "Màu hiện tại" luôn đứng sau 8 màu của bảng màu.
  const selected = matched ? LABEL_PALETTE.indexOf(matched) : legacyNow ? LABEL_PALETTE.length : -1;
  const entry = selected >= 0 ? selected : 0;

  return (
    <div
      id={id ?? autoId}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={describedBy}
      aria-disabled={disabled ? 'true' : undefined}
      onKeyDown={disabled ? undefined : radioGroupKeyDownSkipDisabled}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {items.map((it, i) => {
        const active = i === selected;
        return (
          <button
            key={`${it.name}:${it.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={it.name}
            title={it.title}
            disabled={disabled}
            tabIndex={i === entry ? 0 : -1}
            onClick={() => {
              if (shouldEmitChange(current, it.value)) onChange(it.value);
            }}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[box-shadow] duration-150 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'ring-2 ring-ink-strong ring-offset-2 ring-offset-bg'
                : 'hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-bg',
            )}
            style={{ backgroundColor: it.fill }}
          >
            {active && <Check className="h-4 w-4 text-bg" strokeWidth={3} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
