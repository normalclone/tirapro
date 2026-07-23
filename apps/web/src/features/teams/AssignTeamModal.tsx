import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useProjects } from '@/features/projects/api';
import { useRoles } from '@/features/roles/api';
import { useAssignTeamToProject } from './api';

/** Thêm cả nhóm vào một dự án: mỗi thành viên nhận (các) vai trò dự án đã chọn. */
export function AssignTeamModal({ open, team, onClose }: { open: boolean; team: TeamDto | null; onClose: () => void }) {
  const { data: projects } = useProjects();
  const { data: roles } = useRoles('PROJECT');
  const assign = useAssignTeamToProject();

  const [projectId, setProjectId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const roleOptions = useMemo(() => (roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color })), [roles]);

  useEffect(() => {
    if (!open) return;
    setProjectId(projects?.[0]?.id ?? '');
    // Mặc định vai trò "Developer" nếu có, không thì vai trò đầu.
    const dev = (roles ?? []).find((r) => /developer|lập trình/i.test(r.name));
    setRoleIds(dev ? [dev.id] : roles?.[0] ? [roles[0].id] : []);
  }, [open, projects, roles]);

  if (!open || !team) return null;

  const busy = assign.isPending;
  const canSave = !!projectId && roleIds.length > 0 && !busy;

  async function submit() {
    if (!canSave || !team) return;
    try {
      const res = await assign.mutateAsync({ id: team.id, projectId, roleIds });
      toast.success(`Đã thêm ${res.added} thành viên nhóm “${team.name}” vào dự án`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[10vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="text-sm font-medium text-ink">Thêm nhóm “{team.name}” vào dự án</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-muted">
            {team.memberCount} thành viên của nhóm sẽ được thêm vào dự án với vai trò bên dưới. Người đã ở trong dự án sẽ được cập nhật vai trò.
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Dự án</label>
            <SearchSelect
              value={projectId}
              onChange={setProjectId}
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key }))}
              placeholder="Chọn dự án…"
              searchPlaceholder="Tìm dự án…"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted">Vai trò trong dự án</label>
            <RoleMultiSelect options={roleOptions} value={roleIds} onChange={setRoleIds} placeholder="Chọn vai trò…" />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSave}>Thêm vào dự án</Button>
        </footer>
      </div>
    </div>
  );
}
