import { useEffect, useId, useRef, useState } from 'react';
import { DateInput } from '@/components/ui/DateInput';
import { FormField } from '@/components/ui/FormField';
import { describedBy } from '@/lib/formErrors';
import { DEFAULT_RANGE_ERROR, dateRangeError, dateRangeSummary } from '@/lib/dateRange';

export interface DateRangeInputProps {
  /** Tên của cả nhóm = tên trường ở form (vd "Thời gian sprint") — đọc khi vào nhóm; không hiện ra. */
  groupLabel: string;
  /** `yyyy-MM-dd` ('' = trống) — giá trị vào/ra giữ nguyên như `DateInput`. */
  start: string;
  end: string;
  onStartChange: (iso: string) => void;
  onEndChange: (iso: string) => void;
  /** Id ô nhập (đích của `focusField`/ErrorSummary, `htmlFor` của nhãn). Mặc định tự sinh. */
  startId?: string;
  endId?: string;
  startLabel?: string;
  endLabel?: string;
  /** Gợi ý dưới ô — nối vào `aria-describedby`, KHÔNG nằm trong tên (vd "(tùy chọn)"). */
  startHint?: string;
  endHint?: string;
  startDisabled?: boolean;
  endDisabled?: boolean;
  /** Chỉ chuyển xuống `DateInput` — không thêm luật bắt buộc mới. */
  startRequired?: boolean;
  endRequired?: boolean;
  /** Câu báo khi kết thúc < bắt đầu (hiện ở ô kết thúc). */
  errorMessage?: string;
  /** Lỗi hiện có của nhóm ('' = hợp lệ): chữ ngày sai ở một ô, hoặc kết thúc < bắt đầu. */
  onErrorChange?: (error: string) => void;
  /** Nhãn `text-xs` (hàng form dày như panel Tài nguyên); mặc định `text-sm` như hộp thoại. */
  compact?: boolean;
  /** Lớp thêm cho cả hai ô nhập (vd `text-sm`). */
  inputClassName?: string;
  className?: string;
  /** Mốc "hôm nay" để quyết định ẩn năm trong tóm tắt (test). */
  now?: Date;
}

const LABEL_CLS = 'mb-1.5 block text-sm font-medium text-muted';

/**
 * Hai ô ngày (bắt đầu – kết thúc) + dòng tóm tắt "14 ngày · 20/10 – 02/11" + kiểm kết thúc ≥ bắt đầu.
 * Dựng từ hai `DateInput` nên giữ nguyên xử lý chữ ngày sai, `data-custom-validity` (`blockOnInvalidDate` vẫn tìm được)
 * và định dạng dd/MM/yyyy. Ô kết thúc nhận `min` = ngày bắt đầu (lịch tô xám ngày sớm hơn) nên lỗi thứ tự — gõ ngày
 * sớm hơn, hoặc dời bắt đầu qua ngày kết thúc đã có — hiện ở ô KẾT THÚC bằng `errorMessage` (`aria-invalid` +
 * `aria-describedby` + dòng lỗi + `customValidity`); `onErrorChange` báo lên để nơi dùng khoá Lưu. Ô trống được phép (luật bắt buộc thuộc nơi dùng). Tóm tắt là vùng `role="status"` luôn có mặt (giữ chỗ, không nhảy
 * bố cục) và được cả hai ô trỏ tới bằng `aria-describedby`. Dưới `sm` hai ô xếp dọc. Lịch hai đầu: hoãn.
 */
export function DateRangeInput({
  groupLabel,
  start,
  end,
  onStartChange,
  onEndChange,
  startId,
  endId,
  startLabel = 'Bắt đầu',
  endLabel = 'Kết thúc',
  startHint,
  endHint,
  startDisabled,
  endDisabled,
  startRequired,
  endRequired,
  errorMessage = DEFAULT_RANGE_ERROR,
  onErrorChange,
  compact,
  inputClassName,
  className,
  now,
}: DateRangeInputProps) {
  const auto = useId();
  const sId = startId ?? `${auto}-start`;
  const eId = endId ?? `${auto}-end`;
  const summaryId = `${auto}-summary`;
  const [startErr, setStartErr] = useState('');
  const [endErr, setEndErr] = useState('');

  const rangeErr = dateRangeError(start, end, errorMessage) ?? '';
  const groupErr = startErr || endErr || rangeErr;
  // Có lỗi (kể cả chữ đang gõ chưa vào giá trị) thì không tóm tắt một khoảng cũ.
  const summary = groupErr ? '' : dateRangeSummary(start, end, now);
  useEffect(() => onErrorChange?.(groupErr), [groupErr, onErrorChange]);
  // Đóng hộp thoại (ô bị gỡ) → báo hết lỗi, để nơi dùng không kẹt nút Lưu bằng lỗi của lần mở trước.
  const report = useRef(onErrorChange);
  report.current = onErrorChange;
  useEffect(() => () => report.current?.(''), []);

  const labelCls = compact ? undefined : LABEL_CLS;
  const summaryRef = summary ? summaryId : undefined;

  return (
    <div role="group" aria-label={groupLabel} className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={sId} label={startLabel} hint={startHint} labelClassName={labelCls}>
          {(a) => (
            <DateInput
              id={a.id}
              value={start}
              onChange={onStartChange}
              onErrorChange={setStartErr}
              aria-describedby={describedBy(a['aria-describedby'], summaryRef)}
              required={startRequired}
              disabled={startDisabled}
              className={inputClassName}
            />
          )}
        </FormField>
        <FormField id={eId} label={endLabel} hint={endHint} labelClassName={labelCls}>
          {(a) => (
            <DateInput
              id={a.id}
              value={end}
              onChange={onEndChange}
              onErrorChange={setEndErr}
              min={start || undefined}
              rangeError={errorMessage}
              aria-describedby={describedBy(a['aria-describedby'], summaryRef)}
              required={endRequired}
              disabled={endDisabled}
              className={inputClassName}
            />
          )}
        </FormField>
      </div>
      <p
        id={summaryId}
        role="status"
        className="mt-1.5 min-h-4 text-xs leading-4 tabular text-muted"
      >
        {summary}
      </p>
    </div>
  );
}
