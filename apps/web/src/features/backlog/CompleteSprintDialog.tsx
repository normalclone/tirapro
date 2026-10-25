import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { RadioCard } from '@/components/ui/RadioCard';
import { Dialog } from '@/components/ui/Dialog';
import type { MoveIncompleteTo } from './api';
import { SearchSelect } from '@/components/ui/SearchSelect';

type Choice = 'backlog' | 'new' | 'existing';

/**
 * Hộp thoại hoàn thành sprint: nếu còn việc chưa xong, chọn chúng đi đâu — về Việc chờ, sang sprint mới
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
    { id: 'backlog', label: 'Về Việc chờ', hint: 'Xếp lại vào sprint sau khi lập kế hoạch.' },
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
          <RadioCard
            className="mt-3"
            ariaLabel="Nơi chuyển việc chưa xong"
            value={choice}
            onChange={setChoice}
            options={options.map((o) => ({
              value: o.id,
              label: o.label,
              description: o.hint,
              disabled: o.disabled,
              children:
                o.id === 'existing' && canPickExisting ? (
                  <SearchSelect
                    ariaLabel="Sprint đích"
                    value={target}
                    onChange={setTargetId}
                    options={futureSprints.map((s) => ({ value: s.id, label: s.name }))}
                    searchPlaceholder="Tìm sprint…"
                    className="h-8"
                  />
                ) : undefined,
            }))}
          />
        </>
      )}
    </Dialog>
  );
}
