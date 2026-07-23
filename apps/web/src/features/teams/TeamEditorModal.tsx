import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { useWorkspaceUsers } from '@/features/members/api';
import { cn } from '@/lib/utils';
import { useCreateTeam, useUpdateTeam } from './api';

/** Bảng màu nhãn nhóm (OKLCH-adjacent, WCAG-friendly trên nền sáng/tối). */
const TEAM_COLORS = ['#2563eb', '#16a34a', '#a855f7', '#f59e0b', '#dc2626', '#0d9488', '#db2777', '#6366f1'];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** Modal tạo/sửa nhóm: tên, màu, mô tả, thành viên & trưởng nhóm. */
export function TeamEditorModal({ open, team, onClose }: { open: boolean; team?: TeamDto | null; onClose: () => void }) {
  const { data: users } = useWorkspaceUsers();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const editing = !!team;

  const [name, setName] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leadId, setLeadId] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? '');
    setColor(team?.color ?? TEAM_COLORS[0]);
    setDescription(team?.description ?? '');
    setMemberIds(team?.members.map((m) => m.id) ?? []);
    setLeadId(team?.lead?.id ?? '');
  }, [open, team]);

  const userOptions = useMemo(() => (users ?? []).map((u) => ({ id: u.id, name: u.displayName })), [users]);
  // Trưởng nhóm chọn trong số thành viên đã chọn (BE tự thêm lead vào nhóm nếu thiếu).
  const leadOptions = useMemo(
    () => [
      { value: '', label: 'Không có' },
      ...(users ?? []).filter((u) => memberIds.includes(u.id)).map((u) => ({ value: u.id, label: u.displayName })),
    ],
    [users, memberIds],
  );

  useEffect(() => {
    // Nếu lead bị bỏ khỏi danh sách thành viên thì reset lead.
    if (leadId && !memberIds.includes(leadId)) setLeadId('');
  }, [memberIds, leadId]);

  if (!open) return null;

  const busy = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    const payload = { name: name.trim(), color, description: description.trim() || null, leadId: leadId || null, memberIds };
    try {
      if (editing && team) {
        await update.mutateAsync({ id: team.id, ...payload });
        toast.success('Đã lưu nhóm');
      } else {
        await create.mutateAsync(payload);
        toast.success('Đã tạo nhóm');
      }
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center p-4 pt-[8vh]">
      <button className="absolute inset-0 bg-black/30 animate-in fade-in duration-200" onClick={onClose} aria-label="Đóng" />
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="text-sm font-medium text-ink">{editing ? 'Sửa nhóm' : 'Tạo nhóm'}</span>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <Field label="Tên nhóm">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Frontend, QA…" autoFocus maxLength={60} />
          </Field>

          <Field label="Màu">
            <div className="flex flex-wrap gap-2">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Màu ${c}`}
                  aria-pressed={color === c}
                  className={cn('h-7 w-7 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                    color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink-strong' : 'hover:scale-110')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          <Field label="Mô tả" hint="(tùy chọn)">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Nhóm này phụ trách gì?" maxLength={500} />
          </Field>

          <Field label="Thành viên" hint="(tùy chọn)">
            <RoleMultiSelect
              options={userOptions}
              value={memberIds}
              onChange={setMemberIds}
              requireOne={false}
              placeholder="Chọn thành viên…"
              ariaLabel="Chọn thành viên nhóm"
            />
          </Field>

          <Field label="Trưởng nhóm" hint="(chọn trong thành viên)">
            <SearchSelect
              value={leadId}
              onChange={setLeadId}
              options={leadOptions}
              placeholder="Không có"
              searchPlaceholder="Tìm thành viên…"
              ariaLabel="Trưởng nhóm"
            />
          </Field>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>{editing ? 'Lưu' : 'Tạo nhóm'}</Button>
        </footer>
      </div>
    </div>
  );
}
