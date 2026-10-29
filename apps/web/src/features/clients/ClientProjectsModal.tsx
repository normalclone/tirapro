import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useRetained } from '@/lib/useRetained';
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
  // Giữ khách hàng gần nhất để nội dung không biến mất giữa hiệu ứng đóng.
  const shown = useRetained(client);

  useEffect(() => {
    if (!open) return;
    setIds(client?.projects.map((p) => p.id) ?? []);
  }, [open, client]);

  const options = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  if (!shown) return null;

  async function save() {
    if (!shown) return;
    try {
      await setProjects.mutateAsync({ id: shown.id, projectIds: ids });
      toast.success('Đã cập nhật danh sách dự án của khách hàng');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Gán dự án · ${shown.name}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => void save()} loading={setProjects.isPending}>
            Lưu thay đổi
          </Button>
        </>
      }
    >
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
    </Dialog>
  );
}
