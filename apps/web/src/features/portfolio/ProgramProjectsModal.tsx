import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { useRetained } from '@/lib/useRetained';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useProjects } from '@/features/projects/api';
import { useSetProgramProjects, type ProgramDto } from './api';

/** Modal gọn: chỉ chọn tập dự án cho một chương trình (thao tác hay dùng nhất). */
export function ProgramProjectsModal({
  open,
  program,
  onClose,
}: {
  open: boolean;
  program: ProgramDto | null;
  onClose: () => void;
}) {
  const { data: projects } = useProjects();
  const setProjects = useSetProgramProjects();
  const [ids, setIds] = useState<string[]>([]);
  // Giữ chương trình gần nhất để nội dung không biến mất giữa hiệu ứng đóng.
  const shown = useRetained(program);

  useEffect(() => {
    if (!open) return;
    setIds(program?.projects.map((p) => p.id) ?? []);
  }, [open, program]);

  const options = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  if (!shown) return null;

  async function save() {
    if (!shown) return;
    try {
      await setProjects.mutateAsync({ id: shown.id, projectIds: ids });
      toast.success('Đã cập nhật danh sách dự án của chương trình');
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
      icon={
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: shown.color ?? 'var(--faint)' }}
        />
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={() => void save()} loading={setProjects.isPending}>
            Lưu thay đổi
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">
        Mỗi dự án chỉ thuộc một chương trình. Dự án bạn bỏ chọn sẽ chuyển về nhóm “Chưa thuộc chương
        trình”, dữ liệu của dự án không bị ảnh hưởng.
      </p>
      <RoleMultiSelect
        options={options}
        value={ids}
        onChange={setIds}
        requireOne={false}
        placeholder="Chọn dự án…"
        ariaLabel="Chọn dự án thuộc chương trình"
      />
    </Dialog>
  );
}
