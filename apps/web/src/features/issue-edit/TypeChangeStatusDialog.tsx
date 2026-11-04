import { useId, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { RadioCard } from '@/components/ui/RadioCard';
import { useWorkflows } from '@/features/workflow-settings/api';
import { STATUS_CATEGORY_LABEL } from '@/lib/terms';
import { typeChangeChoices } from './typeChange';

/**
 * Hộp "Chọn trạng thái trong quy trình mới": đổi loại việc sang loại dùng quy trình khác thì trạng thái hiện tại không còn
 * hợp lệ, nên hỏi trước khi đổi. Chọn sẵn trạng thái máy chủ gợi ý (cùng tên → cùng nhóm → đầu tiên) để Enter là xong.
 */
export function TypeChangeStatusDialog({
  open,
  issueKey,
  fromStatusName,
  newTypeName,
  suggestedStatusId,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  issueKey: string;
  fromStatusName: string;
  newTypeName: string;
  suggestedStatusId: string | undefined;
  loading?: boolean;
  onConfirm: (statusId: string) => void;
  onCancel: () => void;
}) {
  const { data: workflows } = useWorkflows();
  const { workflow, statuses } = typeChangeChoices(workflows, suggestedStatusId);
  const [picked, setPicked] = useState<string | null>(suggestedStatusId ?? null);
  const labelId = useId();
  const chosen = picked && statuses.some((s) => s.id === picked) ? picked : null;
  const confirm = () => {
    if (chosen && !loading) onConfirm(chosen);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title="Chọn trạng thái trong quy trình mới"
      description={`${issueKey} đang ở “${fromStatusName}”. Loại ${newTypeName} dùng ${
        workflow ? `quy trình “${workflow.name}”` : 'một quy trình khác'
      }, nên cần chọn trạng thái tương ứng.`}
      icon={<Shuffle className="h-4 w-4" />}
      size="sm"
      onSubmit={confirm}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Huỷ
          </Button>
          <Button size="sm" onClick={confirm} loading={loading} disabled={!chosen}>
            Đổi loại và chuyển
          </Button>
        </>
      }
    >
      {statuses.length === 0 ? (
        <p className="text-sm text-muted">
          {workflows ? 'Quy trình mới chưa có trạng thái nào.' : 'Đang tải quy trình…'}
        </p>
      ) : (
        <div>
          <p id={labelId} className="mb-1.5 text-sm font-medium text-ink">
            Trạng thái mới
          </p>
          <RadioCard
            size="sm"
            ariaLabelledby={labelId}
            value={chosen}
            onChange={setPicked}
            options={statuses.map((s) => ({
              value: s.id,
              label: s.name,
              description: [
                STATUS_CATEGORY_LABEL[s.category],
                s.id === suggestedStatusId ? 'gợi ý' : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
          />
        </div>
      )}
    </Dialog>
  );
}
