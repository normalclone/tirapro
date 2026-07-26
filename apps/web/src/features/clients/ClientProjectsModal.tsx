import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useProjects } from '@/features/projects/api';
import { useSetClientProjects, type ClientDto } from './api';

/** Modal gọn: chọn tập dự án thuộc về một khách hàng. */
export function ClientProjectsModal({
  open,
  client,
  onClose,
}: {
  open: boolean;
  client: ClientDto | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const setProjects = useSetClientProjects();
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setIds(client?.projects.map((p) => p.id) ?? []);
  }, [open, client]);

  const options = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  if (!open || !client) return null;

  async function save() {
    if (!client) return;
    try {
      await setProjects.mutateAsync({ id: client.id, projectIds: ids });
      toast.success('Đã cập nhật danh sách dự án của khách hàng');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Gán dự án cho ${client.name}`}
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-ink">Gán dự án · {client.name}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="px-5 py-4">
          <p className="mb-2 text-sm text-muted">
            Mỗi dự án chỉ thuộc một khách hàng. Dự án bạn bỏ chọn sẽ không còn gắn với khách hàng này,
            dữ liệu của dự án không bị ảnh hưởng.
          </p>
          <RoleMultiSelect
            options={options}
            value={ids}
            onChange={setIds}
            requireOne={false}
            placeholder="Chọn dự án…"
            ariaLabel="Chọn dự án của khách hàng"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={setProjects.isPending}>Lưu thay đổi</Button>
        </footer>
      </div>
    </div>
  );
}
