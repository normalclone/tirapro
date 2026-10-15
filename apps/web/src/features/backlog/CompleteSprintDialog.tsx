import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import type { MoveIncompleteTo } from './api';

type Choice = 'backlog' | 'new' | 'existing';

/**
 * Hộp thoại hoàn thành sprint: nếu còn việc chưa xong, chọn chúng đi đâu — về Backlog, sang sprint mới
 * (máy chủ tự tạo "Sprint N+1" ở trạng thái FUTURE) hoặc sang một sprint chưa bắt đầu có sẵn.
 */
export function CompleteSprintDialog({
  open,
  name,
  notDone,
  futureSprints,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  name: string;
  notDone: number;
  /** Sprint FUTURE của dự án để chọn làm đích. */
  futureSprints: SprintDto[];
  loading: boolean;
  onConfirm: (moveIncompleteTo: MoveIncompleteTo) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<Choice>('backlog');
  const [targetId, setTargetId] = useState('');
  const canPickExisting = futureSprints.length > 0;
  const target = targetId || futureSprints[0]?.id || '';

  function submit() {
    if (notDone === 0 || choice === 'backlog') onConfirm('backlog');
    else if (choice === 'new') onConfirm('new');
    else if (target) onConfirm({ sprintId: target });
  }

  const options: Array<{ id: Choice; label: string; hint: string; disabled?: boolean }> = [
    { id: 'backlog', label: 'Về Backlog', hint: 'Xếp lại vào sprint sau khi lập kế hoạch.' },
    {
      id: 'new',
      label: 'Sang sprint mới',
      hint: 'Tự tạo một sprint chưa bắt đầu và đưa việc vào đó.',
    },
    {
      id: 'existing',
      label: 'Sang sprint có sẵn',
      hint: canPickExisting
        ? 'Chọn một sprint chưa bắt đầu.'
        : 'Chưa có sprint nào đang chờ — hãy tạo sprint trước hoặc chọn “Sang sprint mới”.',
      disabled: !canPickExisting,
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) onCancel();
      }}
      title={`Kết thúc sprint “${name}”?`}
      description={
        notDone === 0
          ? 'Mọi việc trong sprint đã xong. Sprint sẽ chuyển sang “Đã kết thúc” và giữ lại để xem báo cáo.'
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            Để sau
          </Button>
          <Button
            size="sm"
            loading={loading}
            onClick={submit}
            disabled={notDone > 0 && choice === 'existing' && !target}
          >
            <CheckCircle2 className="h-4 w-4" />
            Kết thúc sprint
          </Button>
        </>
      }
    >
      {notDone === 0 ? undefined : (
        <>
          <p className="text-sm text-muted">
            Còn <span className="font-medium text-ink">{notDone}</span> việc chưa xong. Bạn muốn đưa
            chúng đi đâu?
          </p>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Nơi chuyển việc chưa xong</legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                  o.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  choice === o.id
                    ? 'border-primary bg-primary-subtle'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  name="complete-dest"
                  className="mt-0.5 accent-[var(--primary)]"
                  checked={choice === o.id}
                  disabled={o.disabled}
                  onChange={() => setChoice(o.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                  {o.id === 'existing' && choice === 'existing' && canPickExisting && (
                    <select
                      aria-label="Sprint đích"
                      value={target}
                      onChange={(e) => setTargetId(e.target.value)}
                      className="mt-2 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      {futureSprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
    </Dialog>
  );
}
