import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
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

  useEffect(() => {
    if (!open) return;
    setIds(program?.projects.map((p) => p.id) ?? []);
  }, [open, program]);

  const options = useMemo(
    () => (projects ?? []).map((p) => ({ id: p.id, name: `${p.key} · ${p.name}` })),
    [projects],
  );

  if (!open || !program) return null;

  async function save() {
    if (!program) return;
    try {
      await setProjects.mutateAsync({ id: program.id, projectIds: ids });
      toast.success('Đã cập nhật dự án của chương trình');
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
        aria-label={`Gán dự án cho ${program.name}`}
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200"
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: program.color ?? 'var(--faint)' }} aria-hidden />
          <span className="min-w-0 truncate text-sm font-medium text-ink">Gán dự án · {program.name}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="px-5 py-4">
          <p className="mb-2 text-sm text-muted">
            Dự án bỏ khỏi danh sách sẽ chuyển về nhóm “Chưa thuộc chương trình”. Mỗi dự án chỉ thuộc một chương trình.
          </p>
          <RoleMultiSelect
            options={options}
            value={ids}
            onChange={setIds}
            requireOne={false}
            placeholder="Chọn dự án…"
            ariaLabel="Chọn dự án thuộc chương trình"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={setProjects.isPending}>Lưu</Button>
        </footer>
      </div>
    </div>
  );
}
