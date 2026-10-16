import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DateInput';
import { buildUnscheduledPatch, NO_SCHEDULE_PERM_HINT, type UnscheduledPatch } from './dragMath';

function Row({
  issue,
  canSchedule,
  onSave,
}: {
  issue: IssueDto;
  canSchedule: boolean;
  onSave: (issue: IssueDto, patch: UnscheduledPatch) => Promise<unknown>;
}) {
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const patch = buildUnscheduledPatch(start, due);
  const orderOk = !start || !due || start <= due;

  async function save() {
    if (!patch || !orderOk) return;
    setSaving(true);
    try {
      await onSave(issue, patch);
    } catch {
      // Toast lỗi do MutationCache hiện; việc vẫn ở danh sách để thử lại.
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
      title={canSchedule ? undefined : NO_SCHEDULE_PERM_HINT}
    >
      <Link
        to={`/issue/${issue.key}`}
        className="shrink-0 font-mono text-xs text-muted hover:text-primary hover:underline"
      >
        {issue.key}
      </Link>
      <span className="min-w-0 flex-1 basis-48 truncate text-sm text-ink">{issue.summary}</span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <DateInput
            ariaLabel={`Bắt đầu ${issue.key}`}
            value={start}
            onChange={setStart}
            max={due || undefined}
            disabled={!canSchedule || saving}
          />
        </div>
        <span className="text-xs text-faint" aria-hidden>
          →
        </span>
        <div className="w-40">
          <DateInput
            ariaLabel={`Hạn ${issue.key}`}
            value={due}
            onChange={setDue}
            min={start || undefined}
            disabled={!canSchedule || saving}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canSchedule || !patch || !orderOk}
          loading={saving}
          onClick={() => void save()}
          title={
            canSchedule ? 'Đặt ngày: việc sẽ hiện thành thanh trên biểu đồ' : NO_SCHEDULE_PERM_HINT
          }
        >
          Đặt ngày
        </Button>
      </div>
    </li>
  );
}

/**
 * Việc chưa có ngày bắt đầu/hạn và không nối vào việc nào (nên không suy ra được thanh). Đặt ngày tại chỗ:
 * lưu xong việc tự rời danh sách và hiện thành thanh trên biểu đồ.
 */
export function UnscheduledPanel({
  issues,
  canSchedule,
  onSave,
  onClose,
}: {
  issues: IssueDto[];
  canSchedule: (issue: IssueDto) => boolean;
  onSave: (issue: IssueDto, patch: UnscheduledPatch) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <section
      id="gantt-unscheduled"
      aria-label="Công việc chưa lên lịch"
      className="border-b border-border bg-surface-2/40 print:hidden"
    >
      <div className="flex items-center gap-2 px-4 pt-2">
        <h2 className="text-sm font-semibold text-ink">Chưa lên lịch ({issues.length})</h2>
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          Đặt bắt đầu và/hoặc hạn để việc hiện thành thanh trên biểu đồ. Bỏ trống một ô = chỉ đặt ô
          còn lại.
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Thu gọn
        </Button>
      </div>
      {issues.length === 0 ? (
        <p className="px-4 pb-3 pt-1 text-sm text-muted">Mọi công việc đều đã có lịch.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-auto pb-1">
          {issues.map((issue) => (
            <Row key={issue.id} issue={issue} canSchedule={canSchedule(issue)} onSave={onSave} />
          ))}
        </ul>
      )}
    </section>
  );
}
