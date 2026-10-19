import { useId, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import { CHIP_TOUCH_HIT } from '@/lib/touchHit';
import { cn } from '@/lib/utils';
import { CardBody } from './Card';
import {
  CARD_DENSITIES,
  CARD_FIELDS,
  isDefaultDisplay,
  setDensity,
  toggleField,
  type CardDisplay,
} from './cardDisplay';

/** Việc mẫu cho phần xem trước: đủ mọi trường (hạn sắp tới để hiện cảnh báo hạn, 4 nhãn để thấy cả "+n"). */
function sampleIssue(): IssueDto {
  return {
    id: 'preview',
    key: 'VD-12',
    summary: 'Đồng bộ danh bạ khi đăng nhập lại trên điện thoại mới',
    type: { id: 'preview-type', name: 'Tác vụ', color: null },
    status: { id: 'preview-status', name: 'In Progress', category: 'IN_PROGRESS' },
    priority: { id: 'preview-priority', name: 'Cao', rank: 2, color: null },
    assignee: { id: 'preview-user', displayName: 'Minh Anh', avatarUrl: null },
    storyPoints: 5,
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    severity: null,
    acceptanceProgress: null,
    labels: ['web', 'đăng nhập', 'ưu tiên', 'mobile'].map((name, i) => ({
      id: `preview-label-${i}`,
      projectId: 'preview',
      name,
      color: null,
    })),
  } as unknown as IssueDto;
}
const SAMPLE_PROGRESS = { done: 1, total: 3 } as never;

/**
 * Nội dung popover: mật độ, trường hiện trên thẻ, xem trước, đặt lại. Đổi là áp NGAY (bảng phía sau cũng đổi ngay —
 * đó là bản xem trước thật; thẻ mẫu chỉ để thấy đủ mọi trường kể cả khi cột đang trống).
 * Tên truy cập của mỗi điều khiển = nhãn nhìn thấy.
 */
export function CardDisplayPanel({
  display,
  onChange,
  onReset,
  titleId,
}: {
  display: CardDisplay;
  onChange: (next: CardDisplay) => void;
  onReset: () => void;
  /** Id của tiêu đề (để khung popover trỏ `aria-labelledby` vào). */
  titleId?: string;
}) {
  const uid = useId();
  const densityLabel = `${uid}-density`;
  const fieldsLabel = `${uid}-fields`;
  const isDefault = isDefaultDisplay(display);
  const issue = useMemo(sampleIssue, []);
  return (
    <div className="space-y-4 p-4">
      <div>
        <h2 id={titleId} className="text-sm font-semibold text-ink-strong">
          Hiển thị thẻ
        </h2>
        <p className="mt-0.5 text-xs text-faint">Lựa chọn này chỉ áp cho bạn, trên bảng này.</p>
      </div>

      <div>
        <p id={densityLabel} className="mb-1.5 text-xs font-medium text-muted">
          Mật độ
        </p>
        <SegmentedControl
          ariaLabelledby={densityLabel}
          size="sm"
          fullWidth
          value={display.density}
          onChange={(v) => onChange(setDensity(display, v))}
          options={CARD_DENSITIES}
        />
      </div>

      <div>
        <p id={fieldsLabel} className="text-xs font-medium text-muted">
          Trường trên thẻ
        </p>
        <p className="mb-1 text-xs text-faint">Mã và tiêu đề luôn hiện.</p>
        <div role="group" aria-labelledby={fieldsLabel} className="space-y-1">
          {CARD_FIELDS.map((f) => (
            <Switch
              key={f.id}
              id={`${uid}-f-${f.id}`}
              label={f.label}
              checked={display.fields[f.id]}
              onChange={() => onChange(toggleField(display, f.id))}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Xem trước</p>
        <div aria-hidden="true" className="pointer-events-none rounded-lg bg-surface-3 p-2">
          <CardBody issue={issue} progress={SAMPLE_PROGRESS} display={display} canDrag={false} />
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        {/* aria-disabled (không `disabled`): bấm xong nút không biến mất khỏi thứ tự Tab, focus ở lại trong popover. */}
        <button
          type="button"
          aria-disabled={isDefault ? 'true' : undefined}
          onClick={() => {
            if (!isDefault) onReset();
          }}
          className={cn(
            'inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:h-11',
            isDefault ? 'cursor-default text-faint' : 'text-primary hover:bg-surface-2',
          )}
        >
          Đặt lại mặc định
        </button>
      </div>
    </div>
  );
}

/**
 * Nút "Hiển thị" trên thanh điều khiển của Bảng việc + popover tuỳ chọn thẻ. Chip như các nút kề (44px khi cảm ứng);
 * đóng popover → Radix trả focus về nút. Khác mặc định → chip tô nền nhẹ + chấm (không chỉ màu: có mô tả "Đã tuỳ chỉnh").
 */
export function CardDisplayPopover({
  display,
  onChange,
  onReset,
}: {
  display: CardDisplay;
  onChange: (next: CardDisplay) => void;
  onReset: () => void;
}) {
  const noteId = useId();
  const titleId = useId();
  const customized = !isDefaultDisplay(display);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Mật độ thẻ và các trường hiện trên thẻ — chỉ áp cho bạn"
          aria-describedby={customized ? noteId : undefined}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            CHIP_TOUCH_HIT,
            customized
              ? 'border-transparent bg-primary-subtle text-primary'
              : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          <span>Hiển thị</span>
          {customized && (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span id={noteId} className="sr-only">
                Đã tuỳ chỉnh
              </span>
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-labelledby={titleId}
          className="z-dropdown max-h-[var(--radix-popover-content-available-height)] w-[min(21rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          <CardDisplayPanel
            display={display}
            onChange={onChange}
            onReset={onReset}
            titleId={titleId}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
