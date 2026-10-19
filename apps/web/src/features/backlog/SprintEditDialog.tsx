import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { ConfirmDialog } from '@/features/issues/ConfirmDialog';
import { apiErrorMessage } from '@/lib/api';
import { useDeleteSprint, useUpdateSprint } from './api';
import { blockOnInvalidDate } from '@/lib/dateGuard';

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
/** Ngày (yyyy-mm-dd) → ISO UTC 00:00 — burndown cũng tính theo ngày UTC nên không lệch ngày. */
const toIso = (d: string) => `${d}T00:00:00.000Z`;

/**
 * Sửa sprint (tên, mục tiêu, ngày) + xoá sprint chưa bắt đầu. Sprint đang chạy chỉ sửa được
 * mục tiêu và ngày kết thúc; sprint đã đóng không mở hộp thoại này.
 * Cha gắn `key` theo lần mở (useOpenSession) nên state khởi tạo lại từ `sprint` mỗi lần mở; giữ `sprint` gần nhất
 * (useRetained) để nội dung còn nguyên suốt hiệu ứng đóng.
 */
export function SprintEditDialog({
  open,
  sprint,
  projectId,
  onClose,
}: {
  open: boolean;
  sprint: SprintDto;
  projectId: string;
  onClose: () => void;
}) {
  const update = useUpdateSprint(projectId);
  const remove = useDeleteSprint(projectId);
  const future = sprint.state === 'FUTURE';
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [start, setStart] = useState(toDateInput(sprint.startDate));
  const [end, setEnd] = useState(toDateInput(sprint.endDate));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Câu báo hiện MỘT lần, ngay tại ô Ngày kết thúc (DateInput `rangeError`); ở đây chỉ để khoá nút Lưu.
  const dateError = !!start && !!end && end < start;
  const dirty =
    (future && name.trim() !== sprint.name) ||
    goal.trim() !== (sprint.goal ?? '') ||
    (future && start !== toDateInput(sprint.startDate)) ||
    end !== toDateInput(sprint.endDate);
  const canSave = dirty && !!name.trim() && !dateError && !update.isPending;

  async function save() {
    if (blockOnInvalidDate()) return;
    try {
      await update.mutateAsync({
        id: sprint.id,
        patch: {
          ...(future && name.trim() !== sprint.name ? { name: name.trim() } : {}),
          ...(goal.trim() !== (sprint.goal ?? '') ? { goal: goal.trim() || null } : {}),
          ...(future && start !== toDateInput(sprint.startDate)
            ? { startDate: start ? toIso(start) : null }
            : {}),
          ...(end !== toDateInput(sprint.endDate) ? { endDate: end ? toIso(end) : null } : {}),
        },
      });
      toast.success(`Đã lưu sprint “${name.trim() || sprint.name}”`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function doDelete() {
    try {
      await remove.mutateAsync(sprint.id);
      toast.success(`Đã xoá sprint “${sprint.name}”. Việc trong sprint đã về Việc chờ.`);
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !update.isPending) onClose();
        }}
        title="Sửa sprint"
        description={
          future
            ? 'Sprint chưa bắt đầu — sửa được mọi thông tin.'
            : 'Sprint đang chạy — chỉ sửa được mục tiêu và ngày kết thúc.'
        }
        footer={
          <>
            {future && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" /> Xoá sprint
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} disabled={update.isPending}>
              Huỷ
            </Button>
            <Button
              size="sm"
              loading={update.isPending}
              disabled={!canSave}
              onClick={() => void save()}
            >
              Lưu
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="sprint-name" className="mb-1.5 block text-sm font-medium text-muted">
              Tên sprint
            </label>
            <Input
              id="sprint-name"
              value={name}
              maxLength={120}
              disabled={!future}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <label htmlFor="sprint-goal" className="mb-1.5 block text-sm font-medium text-muted">
              Mục tiêu
            </label>
            <textarea
              id="sprint-goal"
              value={goal}
              maxLength={1000}
              rows={2}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Sprint này muốn đạt được điều gì?"
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sprint-start" className="mb-1.5 block text-sm font-medium text-muted">
                Ngày bắt đầu
              </label>
              <DateInput
                id="sprint-start"
                value={start}
                disabled={!future}
                onChange={setStart}
                className="text-sm"
              />
            </div>
            <div>
              <label htmlFor="sprint-end" className="mb-1.5 block text-sm font-medium text-muted">
                Ngày kết thúc
              </label>
              <DateInput
                id="sprint-end"
                value={end}
                min={start || undefined}
                rangeError="Ngày kết thúc không được trước ngày bắt đầu"
                onChange={setEnd}
                className="text-sm"
              />
            </div>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title={`Xoá sprint “${sprint.name}”?`}
        description={
          sprint.issueCount
            ? `${sprint.issueCount} việc trong sprint sẽ quay về Việc chờ. Sprint đã xoá không khôi phục được.`
            : 'Sprint trống sẽ bị xoá. Không thể khôi phục.'
        }
        confirmLabel="Xoá sprint"
        loading={remove.isPending}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
