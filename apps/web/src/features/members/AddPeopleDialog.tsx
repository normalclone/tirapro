import { useEffect, useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useRoles } from '@/features/roles/api';
import { useTeams } from '@/features/teams/api';
import { cn } from '@/lib/utils';
import { useAllUsers, useWorkspaceMembers, useProjectMembers, useAddMembersBulk, useAddProjectMembersBulk } from './api';

interface Cand {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  roleNames: string[];
  teams: { id: string; name: string; color: string | null }[];
}

/**
 * Thêm NHIỀU người một lúc vào workspace hoặc dự án, có bộ lọc.
 * - workspace: ứng viên = user hệ thống CHƯA thuộc workspace (lọc: tìm kiếm).
 * - project: ứng viên = thành viên workspace CHƯA ở dự án (lọc: tìm kiếm + nhóm + vai trò workspace).
 */
export function AddPeopleDialog({
  open, onClose, mode, projectId,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'workspace' | 'project';
  projectId?: string;
}) {
  const isProject = mode === 'project';
  const { data: allUsers } = useAllUsers(undefined, open && !isProject);
  const { data: wsMembers } = useWorkspaceMembers();
  const { data: projMembers } = useProjectMembers(isProject ? projectId : undefined);
  const { data: teams } = useTeams();
  const { data: roles } = useRoles(isProject ? 'PROJECT' : 'WORKSPACE');
  const addWs = useAddMembersBulk();
  const addProj = useAddProjectMembersBulk(projectId ?? '');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQ(''); setTeamFilter(''); setRoleFilter('');
    const def = (roles ?? []).find((r) => (isProject ? /developer|lập trình/i : /member|thành viên/i).test(r.name));
    setRoleIds(def ? [def.id] : roles?.[0] ? [roles[0].id] : []);
  }, [open, roles, isProject]);

  const candidates = useMemo<Cand[]>(() => {
    if (isProject) {
      const inProj = new Set((projMembers ?? []).map((m) => m.user.id));
      const teamByUser = new Map<string, Cand['teams']>();
      for (const t of teams ?? []) {
        for (const u of t.members ?? []) {
          const arr = teamByUser.get(u.id) ?? [];
          arr.push({ id: t.id, name: t.name, color: t.color ?? null });
          teamByUser.set(u.id, arr);
        }
      }
      return (wsMembers ?? [])
        .filter((m) => !inProj.has(m.user.id))
        .map((m) => ({ id: m.user.id, name: m.user.displayName, email: m.user.email, avatarUrl: m.user.avatarUrl, roleNames: m.roles.map((r) => r.name), teams: teamByUser.get(m.user.id) ?? [] }));
    }
    const inWs = new Set((wsMembers ?? []).map((m) => m.user.id));
    return (allUsers ?? [])
      .filter((u) => !inWs.has(u.id))
      .map((u) => ({ id: u.id, name: u.displayName, email: u.email, avatarUrl: u.avatarUrl, roleNames: [], teams: [] }));
  }, [isProject, allUsers, wsMembers, projMembers, teams]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return candidates.filter((c) => {
      if (query && !`${c.name} ${c.email}`.toLowerCase().includes(query)) return false;
      if (isProject && teamFilter && !c.teams.some((t) => t.id === teamFilter)) return false;
      if (isProject && roleFilter && !c.roleNames.includes(roleFilter)) return false;
      return true;
    });
  }, [candidates, q, teamFilter, roleFilter, isProject]);

  if (!open) return null;

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const busy = addWs.isPending || addProj.isPending;
  const canSubmit = selected.size > 0 && roleIds.length > 0 && !busy;

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => n.delete(c.id));
      else filtered.forEach((c) => n.add(c.id));
      return n;
    });
  }

  async function submit() {
    if (!canSubmit) return;
    const userIds = [...selected];
    try {
      const res = isProject ? await addProj.mutateAsync({ userIds, roleIds }) : await addWs.mutateAsync({ userIds, roleIds });
      toast.success(`Đã thêm ${res.added} người${res.skipped ? ` · bỏ qua ${res.skipped} (đã có)` : ''}`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const roleOptions = (roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[7vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div className="relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-ink">{isProject ? 'Thêm người vào dự án' : 'Thêm người vào workspace'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        {/* Bộ lọc */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên hoặc email…" className="h-9 pl-8 text-sm" autoFocus />
          </div>
          {isProject && (
            <>
              <SearchSelect
                value={teamFilter}
                onChange={setTeamFilter}
                options={[{ value: '', label: 'Mọi nhóm' }, ...(teams ?? []).map((t) => ({ value: t.id, label: t.name, color: t.color }))]}
                placeholder="Mọi nhóm"
                className="h-9 w-40 text-sm"
              />
              <SearchSelect
                value={roleFilter}
                onChange={setRoleFilter}
                options={[{ value: '', label: 'Mọi vai trò' }, ...[...new Set(candidates.flatMap((c) => c.roleNames))].map((n) => ({ value: n, label: n }))]}
                placeholder="Mọi vai trò"
                className="h-9 w-44 text-sm"
              />
            </>
          )}
        </div>

        {/* Danh sách ứng viên (multi-select) */}
        <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
          <button type="button" onClick={toggleAll} disabled={filtered.length === 0} className="font-medium text-primary hover:underline disabled:opacity-40">
            {allFilteredSelected ? 'Bỏ chọn tất cả' : `Chọn tất cả (${filtered.length})`}
          </button>
          <span>Đã chọn <span className="tabular font-semibold text-ink">{selected.size}</span></span>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="listbox" aria-multiselectable>
          {filtered.map((c) => {
            const on = selected.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(c.id)}
                  className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-2', on && 'bg-primary-subtle/50')}
                >
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong')}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <Avatar name={c.name} src={c.avatarUrl} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-strong">{c.name}</span>
                    <span className="block truncate text-xs text-faint">{c.email}</span>
                  </span>
                  {(c.roleNames.length > 0 || c.teams.length > 0) && (
                    <span className="hidden max-w-[45%] flex-wrap items-center justify-end gap-1 sm:flex">
                      {c.roleNames.slice(0, 2).map((r) => <span key={r} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{r}</span>)}
                      {c.teams.slice(0, 2).map((t) => (
                        <span key={t.id} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `color-mix(in oklch, ${t.color || 'var(--faint)'} 16%, transparent)`, color: t.color || 'var(--faint)' }}>{t.name}</span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted">Không còn ai để thêm (khớp bộ lọc).</li>}
        </ul>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <label className="mr-1 text-sm text-muted">Vai trò:</label>
          <div className="min-w-[14rem] flex-1"><RoleMultiSelect options={roleOptions} value={roleIds} onChange={setRoleIds} /></div>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSubmit}>Thêm {selected.size > 0 ? `${selected.size} người` : ''}</Button>
        </footer>
      </div>
    </div>
  );
}
