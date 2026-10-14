import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useSwitchWorkspace } from './api';

interface CreatedWorkspace {
  id: string;
  name: string;
  slug: string;
}

/** Lập không gian làm việc mới; trả về nơi vừa tạo. */
function useCreateWorkspace() {
  return useMutation({
    mutationFn: (name: string) =>
      api.post<CreatedWorkspace>('/workspaces', { name }).then((r) => r.data),
  });
}

export function CreateWorkspaceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateWorkspace();
  const switchWs = useSwitchWorkspace();

  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  if (!open) return null;

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;
  // switchWs.onSuccess reload trang nên giữ trạng thái loading qua cả 2 bước.
  const busy = create.isPending || switchWs.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const created = await create.mutateAsync(trimmedName);
      toast.success(`Đã tạo không gian làm việc ${created.name}`);
      onClose();
      // Chuyển sang nơi vừa lập: cấp token mới + reload (xử lý trong useSwitchWorkspace).
      switchWs.mutate(created.id, {
        onError: (err) => toast.error(apiErrorMessage(err)),
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Tạo không gian làm việc"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="create-workspace-form" loading={busy} disabled={!canSubmit}>
            Tạo không gian làm việc
          </Button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label htmlFor="cw-name" className="mb-1.5 block text-sm font-medium text-muted">
            Tên không gian làm việc
          </label>
          <Input
            id="cw-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Công ty ABC"
            className="text-sm"
          />
          <p className="mt-1.5 text-xs text-faint">
            Đây là nơi riêng để chứa dự án và thành viên — thường ứng với một công ty hoặc một phòng ban. Tạo xong, bạn sẽ được chuyển sang ngay.
          </p>
        </div>
      </form>
    </Dialog>
  );
}
