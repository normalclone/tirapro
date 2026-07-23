import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useSwitchWorkspace } from './api';

interface CreatedWorkspace {
  id: string;
  name: string;
  slug: string;
}

/** Tạo workspace mới; trả về workspace vừa tạo. */
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
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
      toast.success(`Đã tạo workspace ${created.name}`);
      onClose();
      // Chuyển sang workspace mới: cấp token mới + reload (xử lý trong useSwitchWorkspace).
      switchWs.mutate(created.id, {
        onError: (err) => toast.error(apiErrorMessage(err)),
      });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
        onClick={onClose}
        aria-label="Đóng"
      />
      <div className="relative flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-ink">Tạo workspace</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="cw-name" className="mb-1.5 block text-sm font-medium text-muted">
                Tên workspace
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
                Sau khi tạo, bạn sẽ được chuyển sang workspace mới.
              </p>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" loading={busy} disabled={!canSubmit}>
              Tạo workspace
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
