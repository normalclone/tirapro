import { useState } from 'react';
import { AlertTriangle, Play } from 'lucide-react';
import type { SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { DateRangeInput } from '@/components/ui/DateRangeInput';
import { Dialog } from '@/components/ui/Dialog';
import { dateRangeError } from '@/lib/dateRange';
import { cn } from '@/lib/utils';
import { dayOf, defaultStart, startWarnings, suggestEnd, toDayIso } from './sprintDefaults';

export interface StartSprintValues {
  startDate: string;
  endDate: string | null;
  goal: string | null;
}

const WEEK_CHOICES = [1, 2, 3] as const;
/** Sprint chưa có ngày kết thúc → mở hộp với +2 tuần (người dùng sửa được/xoá được). */
const DEFAULT_WEEKS = 2;

/**
 * Hộp xác nhận "Bắt đầu sprint": chốt ngày bắt đầu (mặc định hôm nay), ngày kết thúc (gợi ý +1/2/3 tuần) và mục
 * tiêu NGAY khi bấm, kèm cảnh báo không chặn. Bắt đầu sprint không hoàn tác được nên đây là lưới an toàn.
 * Cha gắn `key` theo lần mở (`useOpenSession`) nên state khởi tạo lại từ `sprint` mỗi lần mở.
 */
export function StartSprintDialog({
  open,
  sprint,
  unestimatedCount,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  sprint: SprintDto;
  /** Số việc trong sprint chưa có điểm ước lượng. */
  unestimatedCount: number;
  loading: boolean;
  onConfirm: (values: StartSprintValues) => void;
  onCancel: () => void;
}) {
  const [initial] = useState(() => {
    const startDay = dayOf(sprint.startDate ?? defaultStart(new Date()));
    return {
      start: startDay,
      end: sprint.endDate
        ? dayOf(sprint.endDate)
        : dayOf(suggestEnd(toDayIso(startDay), DEFAULT_WEEKS)),
    };
  });
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  // Số tuần của ngày kết thúc đang là "gợi ý" (đổi theo ngày bắt đầu); null khi người dùng đã tự nhập.
  const [weeks, setWeeks] = useState<number | null>(sprint.endDate ? null : DEFAULT_WEEKS);
  const [goal, setGoal] = useState(sprint.goal ?? '');
  // Lỗi hiện có của cặp ngày (chữ ngày sai ở một ô hoặc kết thúc < bắt đầu) — do DateRangeInput báo lên.
  const [dateErr, setDateErr] = useState('');

  const issueCount = sprint.issueCount ?? 0;
  const totalPoints = sprint.totalPoints ?? 0;
  const canConfirm = !!start && !dateErr && !dateRangeError(start, end) && !loading;
  const warnings = startWarnings({
    issueCount,
    totalPoints,
    hasGoal: goal.trim() !== '',
    hasEnd: end !== '',
    unestimatedCount,
  });

  function changeStart(iso: string) {
    setStart(iso);
    if (iso && weeks !== null) setEnd(dayOf(suggestEnd(toDayIso(iso), weeks)));
  }

  function pickWeeks(n: number) {
    if (!start) return;
    setWeeks(n);
    setEnd(dayOf(suggestEnd(toDayIso(start), n)));
  }

  function submit() {
    if (!canConfirm) return;
    onConfirm({
      startDate: toDayIso(start),
      endDate: end ? toDayIso(end) : null,
      goal: goal.trim() || null,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onCancel();
      }}
      title={`Bắt đầu “${sprint.name}”?`}
      description={`${issueCount} việc · ${totalPoints} điểm`}
      icon={<Play className="h-4 w-4" aria-hidden />}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            Huỷ
          </Button>
          <Button size="sm" loading={loading} disabled={!canConfirm} onClick={submit}>
            Bắt đầu sprint
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <DateRangeInput
          groupLabel="Thời gian sprint"
          startId="start-sprint-start"
          endId="start-sprint-end"
          startLabel="Ngày bắt đầu"
          endLabel="Ngày kết thúc"
          start={start}
          end={end}
          onStartChange={changeStart}
          onEndChange={(iso) => {
            setEnd(iso);
            setWeeks(null);
          }}
          onErrorChange={setDateErr}
          startRequired
        />
        <DurationChips weeks={weeks} start={start} onPick={pickWeeks} />

        <div>
          <label
            htmlFor="start-sprint-goal"
            className="mb-1.5 block text-sm font-medium text-muted"
          >
            Mục tiêu
          </label>
          <textarea
            id="start-sprint-goal"
            value={goal}
            maxLength={1000}
            rows={2}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Sprint này muốn đạt được điều gì?"
            className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>

        <WarningList warnings={warnings} />

        <p className="text-xs text-muted">
          Không hoàn tác được: nếu bắt đầu nhầm, hãy kết thúc sprint sớm.
          <span className="kbd-hint"> Nhấn Ctrl/Cmd+Enter để xác nhận.</span>
        </p>
      </div>
    </Dialog>
  );
}

/** Chip 1/2/3 tuần (khoảng ngày xem trước nằm ở dòng tóm tắt của DateRangeInput). */
function DurationChips({
  weeks,
  start,
  onPick,
}: {
  weeks: number | null;
  start: string;
  onPick: (weeks: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Gợi ý thời lượng">
      <span className="text-xs text-muted">Thời lượng:</span>
      {WEEK_CHOICES.map((n) => {
        const active = weeks === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={active}
            disabled={!start}
            onClick={() => onPick(n)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              // Chip bật/tắt: nhánh "bật" khi vô hiệu giữ nền nhạt + viền/chữ chính mờ để vẫn thấy đang chọn.
              active
                ? 'border-primary bg-primary-subtle text-primary disabled:cursor-not-allowed disabled:border-primary/40 disabled:text-primary/60'
                : 'border-border text-muted hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-bg disabled:text-disabled-fg',
            )}
          >
            {n} tuần
          </button>
        );
      })}
    </div>
  );
}

/** Cảnh báo không chặn trước khi bắt đầu sprint. */
function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul
      aria-label="Lưu ý trước khi bắt đầu"
      className="space-y-1 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-ink"
    >
      {warnings.map((w) => (
        <li key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {w}
        </li>
      ))}
    </ul>
  );
}
