import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { Field, IssueDefaultsFields } from './IssueDefaultsFields';
import {
  FREQ_LABELS, WEEKDAY_LABELS, describeRecurrence, useCreateRecurring, useUpdateRecurring,
  type IssuePayload, type RecurrenceFreq, type RecurringIssue,
} from './api';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}:00` }));
const FREQ_OPTIONS = (Object.keys(FREQ_LABELS) as RecurrenceFreq[]).map((f) => ({ value: f, label: FREQ_LABELS[f] }));
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label }));

/** Tạo / sửa lịch lặp của công việc lặp lại. `item = null` là tạo mới. */
export function RecurringModal({
  open, item, onClose,
}: {
  open: boolean;
  item: RecurringIssue | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();

  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [freq, setFreq] = useState<RecurrenceFreq>('WEEKLY');
  const [interval, setInterval] = useState(1);
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [hour, setHour] = useState(8);
  const [active, setActive] = useState(true);
  const [payload, setPayload] = useState<IssuePayload>({});

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setProjectId(item?.projectId ?? projects?.[0]?.id ?? '');
    setFreq(item?.freq ?? 'WEEKLY');
    setInterval(item?.interval ?? 1);
    setWeekday(item?.weekday ?? 1);
    setMonthDay(item?.monthDay ?? 1);
    setHour(item?.hour ?? 8);
    setActive(item?.active ?? true);
    setPayload(item?.payload ?? {});
  }, [open, item, projects]);

  const metaKey = useMemo(
    () => (projects ?? []).find((p) => p.id === projectId)?.key ?? projects?.[0]?.key,
    [projects, projectId],
  );

  if (!open) return null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !!projectId && !!payload.typeId && !busy;
  const preview = describeRecurrence({ freq, interval, weekday, monthDay, hour });

  async function submit() {
    if (!canSave) return;
    const base = {
      name: name.trim(),
      freq,
      interval,
      weekday: freq === 'WEEKLY' ? weekday : null,
      monthDay: freq === 'MONTHLY' ? monthDay : null,
      hour,
      active,
      payload,
    };
    try {
      if (item) await update.mutateAsync({ id: item.id, projectId: item.projectId, ...base });
      else await create.mutateAsync({ projectId, ...base });
      toast.success(item ? 'Đã cập nhật lịch lặp' : 'Đã tạo lịch lặp');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center overflow-y-auto p-4 py-[6vh]">
      <button className="fixed inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item ? 'Sửa lịch lặp' : 'Lịch lặp mới'}
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">{item ? 'Sửa lịch lặp' : 'Lịch lặp mới'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <Field label="Tên lịch lặp" htmlFor="rec-name" hint="Tên này chỉ hiện trong danh sách lịch, giúp bạn nhận ra nhanh.">
            <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Họp đầu tuần" autoFocus maxLength={120} />
          </Field>

          <Field label="Dự án" htmlFor="rec-project" hint={item ? 'Không đổi được dự án của lịch đã tạo — hãy tạo lịch mới nếu cần.' : 'Công việc sinh ra sẽ nằm trong dự án này.'}>
            <SearchSelect
              id="rec-project"
              value={projectId}
              onChange={setProjectId}
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key }))}
              placeholder="Chọn dự án…"
              searchPlaceholder="Tìm dự án…"
              ariaLabel="Dự án"
              disabled={!!item}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Tần suất" htmlFor="rec-freq">
              <SearchSelect
                id="rec-freq"
                value={freq}
                onChange={(v) => setFreq(v as RecurrenceFreq)}
                options={FREQ_OPTIONS}
                ariaLabel="Tần suất"
                searchPlaceholder="Tìm…"
              />
            </Field>
            <Field label="Cách mỗi" htmlFor="rec-interval" hint="1 = mỗi kỳ, 2 = cách một kỳ.">
              <Input
                id="rec-interval"
                type="number"
                min={1}
                max={52}
                value={interval}
                onChange={(e) => setInterval(Math.min(52, Math.max(1, Number(e.target.value) || 1)))}
                aria-label="Số kỳ giữa hai lần tạo việc"
                title="Số kỳ giữa hai lần tạo việc. Ví dụ tần suất Hằng tuần và giá trị 2 nghĩa là hai tuần một lần."
              />
            </Field>
            <Field label="Giờ tạo việc" htmlFor="rec-hour">
              <SearchSelect
                id="rec-hour"
                value={String(hour)}
                onChange={(v) => setHour(Number(v))}
                options={HOUR_OPTIONS}
                ariaLabel="Giờ tạo việc"
                searchPlaceholder="Tìm giờ…"
              />
            </Field>
          </div>

          {freq === 'WEEKLY' && (
            <Field label="Vào thứ mấy" htmlFor="rec-weekday">
              <SearchSelect
                id="rec-weekday"
                value={String(weekday)}
                onChange={(v) => setWeekday(Number(v))}
                options={WEEKDAY_OPTIONS}
                ariaLabel="Ngày trong tuần"
                searchPlaceholder="Tìm thứ…"
              />
            </Field>
          )}

          {freq === 'MONTHLY' && (
            <Field label="Vào ngày mấy" htmlFor="rec-monthday" hint="Nếu tháng không có ngày này, hệ thống lùi về ngày cuối tháng.">
              <Input
                id="rec-monthday"
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) => setMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                aria-label="Ngày trong tháng"
              />
            </Field>
          )}

          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
            Hệ thống sẽ tạo công việc: <span className="font-medium text-ink-strong">{preview}</span>
          </p>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[var(--primary)]"
            />
            Bật lịch này — hệ thống tự tạo công việc theo lịch trên
          </label>

          <IssueDefaultsFields
            projectKey={metaKey}
            value={payload}
            onChange={setPayload}
            summaryPlaceholder="Ví dụ: Họp đầu tuần {{ngay}}"
            summaryHint="Dùng {{ngay}} hoặc {{thang}} để chèn ngày/tháng lúc tạo. Bỏ trống thì lấy tên lịch lặp làm tiêu đề."
          />
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          {!payload.typeId && <span className="mr-auto text-xs text-faint">Hãy chọn loại công việc trước khi lưu.</span>}
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSave}>{item ? 'Lưu thay đổi' : 'Tạo lịch lặp'}</Button>
        </footer>
      </div>
    </div>
  );
}
