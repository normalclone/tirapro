import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { apiErrorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/dateFormat';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useAddCheckIn, useCheckIns, type GoalDto, type KeyResultDto } from './api';
import { describeDelta, formatKrValue } from './krFormat';

const PAGE = 30;
const MAX = 50;

/**
 * Khung neo vào nút: popover từ `md` trở lên, hộp thoại giữa màn hình ở màn nhỏ (popover bị cắt/khó bấm trên điện thoại).
 * `renderTrigger(onClick)`: ở màn nhỏ `onClick` mở hộp thoại; ở màn rộng Radix tự gắn vào nút.
 */
function AnchoredPanel({
  title,
  renderTrigger,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  renderTrigger: (onClick?: () => void) => ReactElement;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wide = useMediaQuery('(min-width: 768px)', true);
  if (wide) {
    return (
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger asChild>{renderTrigger()}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            aria-label={title}
            className="z-dropdown w-80 rounded-lg border border-border bg-surface p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <p className="mb-2 text-sm font-medium text-ink">{title}</p>
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <>
      {renderTrigger(() => onOpenChange(true))}
      <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm">
        {children}
      </Dialog>
    </>
  );
}

function CheckInForm({
  goal,
  kr,
  onDone,
}: {
  goal: GoalDto;
  kr: KeyResultDto;
  onDone: () => void;
}) {
  const add = useAddCheckIn();
  const [raw, setRaw] = useState(String(kr.currentValue));
  const [note, setNote] = useState('');
  const value = Number(raw);
  const valid = raw.trim() !== '' && Number.isFinite(value);
  const delta = valid ? describeDelta(kr.currentValue, value, kr) : '';

  async function submit() {
    if (!valid || add.isPending) return;
    try {
      await add.mutateAsync({
        goalId: goal.id,
        keyResultId: kr.id,
        value,
        expectedValue: kr.currentValue,
        note: note.trim() || undefined,
      });
      toast.success('Đã ghi check-in');
      onDone();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-2.5" onKeyDown={onKeyDown}>
      <label className="block text-xs text-faint">
        Giá trị mới{kr.unitLabel && kr.unit !== 'PERCENT' ? ` (${kr.unitLabel})` : ''}
        <Input
          autoFocus
          type="number"
          step="any"
          inputMode="decimal"
          className="mt-1 tabular-nums"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void submit();
            }
          }}
          aria-label={`Giá trị mới của ${kr.name}`}
        />
      </label>
      {delta && delta !== '0' && (
        <p className="text-xs text-muted">
          Thay đổi {delta} so với {formatKrValue(kr.currentValue, kr.unit, kr.unitLabel)} hiện tại
        </p>
      )}
      <label className="block text-xs text-faint">
        Ghi chú <span>(tùy chọn)</span>
        <Input
          className="mt-1 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: Đã vá 2 bug lớn"
          maxLength={500}
          aria-label="Ghi chú check-in"
        />
      </label>
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <span className="mr-auto text-[11px] text-faint">Ctrl/Cmd + Enter để lưu</span>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Hủy
        </Button>
        <Button size="sm" onClick={() => void submit()} loading={add.isPending} disabled={!valid}>
          Lưu check-in
        </Button>
      </div>
    </div>
  );
}

/** Nút "Check-in": cập nhật số hiện tại kèm ghi chú (chỉ cho KR nhập tay, người có quyền quản lý mục tiêu). */
export function CheckInButton({ goal, kr }: { goal: GoalDto; kr: KeyResultDto }) {
  const [open, setOpen] = useState(false);
  return (
    <AnchoredPanel
      title={`Check-in — ${kr.name}`}
      open={open}
      onOpenChange={setOpen}
      renderTrigger={(onClick) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          title="Cập nhật số hiện tại và ghi chú vì sao thay đổi"
        >
          Check-in
        </Button>
      )}
    >
      {open && <CheckInForm goal={goal} kr={kr} onDone={() => setOpen(false)} />}
    </AnchoredPanel>
  );
}

function HistoryList({ goal, kr }: { goal: GoalDto; kr: KeyResultDto }) {
  const [limit, setLimit] = useState(PAGE);
  const { data, isPending, isError } = useCheckIns(goal.id, kr.id, limit, true);
  const rows = data ?? [];
  const moreAvailable = rows.length === limit && limit < MAX;
  return (
    <div>
      {isPending && <p className="text-sm text-faint">Đang tải…</p>}
      {isError && <p className="text-sm text-danger">Không tải được lịch sử.</p>}
      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
        {rows.map((c) => {
          const delta = describeDelta(c.previousValue, c.value, kr);
          return (
            <li key={c.id} className="leading-snug">
              <span className="tabular-nums text-faint">{fmtDate(c.createdAt)}</span>
              {' · '}
              <span className="tabular-nums font-medium text-ink">
                {formatKrValue(c.value, kr.unit, kr.unitLabel)}
              </span>
              {delta && <span className="tabular-nums text-muted"> ({delta})</span>}
              {c.note && <span className="text-ink"> · “{c.note}”</span>}
              {c.author && <span className="text-muted"> — {c.author.displayName}</span>}
            </li>
          );
        })}
        <li className="leading-snug text-muted">
          Giá trị bắt đầu: {formatKrValue(kr.startValue, kr.unit, kr.unitLabel)}
        </li>
      </ul>
      {moreAvailable && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit(MAX)}>
          Xem thêm
        </Button>
      )}
      {rows.length === MAX && (
        <p className="mt-2 text-xs text-faint">Hiển thị {MAX} lần check-in gần nhất.</p>
      )}
    </div>
  );
}

/** Nút "Lịch sử (n)": danh sách check-in mới nhất trước, kết thúc bằng giá trị bắt đầu. */
export function CheckInHistoryButton({ goal, kr }: { goal: GoalDto; kr: KeyResultDto }) {
  const [open, setOpen] = useState(false);
  return (
    <AnchoredPanel
      title={`Lịch sử — ${kr.name}`}
      open={open}
      onOpenChange={setOpen}
      renderTrigger={(onClick) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClick}
          title="Các lần cập nhật số: ngày, giá trị, thay đổi, ghi chú, người ghi"
        >
          Lịch sử ({kr.checkInCount})
        </Button>
      )}
    >
      {open && <HistoryList goal={goal} kr={kr} />}
    </AnchoredPanel>
  );
}
