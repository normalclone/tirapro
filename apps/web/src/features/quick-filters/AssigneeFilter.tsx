import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, UserRound, Users } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import type { PersonOption } from '@/components/ui/PeoplePicker';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Giá trị đặc biệt cho bộ lọc: '' = mọi người, dưới đây = việc chưa có người phụ trách. */
export const ASSIGNEE_UNASSIGNED = '__unassigned__';

/** Lọc công việc theo người phụ trách (ngay tại trình duyệt). */
export function applyAssigneeFilter<T extends Pick<IssueDto, 'assigneeId'>>(issues: T[], value: string): T[] {
  if (!value) return issues;
  if (value === ASSIGNEE_UNASSIGNED) return issues.filter((i) => !i.assigneeId);
  return issues.filter((i) => i.assigneeId === value);
}

/** Dropdown lọc theo người phụ trách — chip cùng phong cách với QuickFilterChips. */
export function AssigneeFilter({ options, value, onChange }: { options: PersonOption[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Thu hẹp danh sách người: theo vai trò và theo nhóm.
  const [roleF, setRoleF] = useState('');
  const [teamF, setTeamF] = useState('');

  const allRoles = [...new Set(options.flatMap((o) => o.roleNames ?? []))].sort((a, b) => a.localeCompare(b, 'vi'));
  const allTeams = [...new Set(options.flatMap((o) => (o.teams ?? []).map((t) => t.name)))].sort((a, b) => a.localeCompare(b, 'vi'));

  const selected = options.find((o) => o.id === value);
  const query = q.trim().toLowerCase();
  const filtered = options.filter((o) => {
    if (query && !o.search.includes(query)) return false;
    if (roleF && !(o.roleNames ?? []).includes(roleF)) return false;
    if (teamF && !(o.teams ?? []).some((t) => t.name === teamF)) return false;
    return true;
  });
  const active = value !== '';
  const label = value === '' ? 'Mọi người' : value === ASSIGNEE_UNASSIGNED ? 'Chưa gán' : selected?.name ?? 'Người phụ trách';

  function pick(v: string) { onChange(v); setOpen(false); setQ(''); }

  const optRow = (isActive: boolean, onClick: () => void, node: React.ReactNode) => (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2', isActive && 'bg-surface-2')}
    >
      <Check className={cn('mt-0.5 h-4 w-4 shrink-0 text-primary', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden />
      {node}
    </button>
  );

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(''); setRoleF(''); setTeamF(''); } }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Lọc theo người phụ trách"
          title={active ? `Đang chỉ hiện việc của: ${label}. Bấm để đổi hoặc bỏ lọc.` : 'Chỉ hiện việc của một người. Bấm để chọn.'}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border pl-1.5 pr-2 text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            active ? 'border-transparent bg-primary-subtle text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          {selected ? <Avatar name={selected.name} src={selected.avatarUrl} size={16} /> : <Users className="ml-0.5 h-3.5 w-3.5" />}
          <span className="max-w-[9rem] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-dropdown w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="space-y-2 border-b border-border p-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, vị trí hoặc nhóm…" aria-label="Tìm người phụ trách" autoFocus className="h-8 text-sm" />
            {(allRoles.length > 0 || allTeams.length > 0) && (
              <div className="flex gap-2">
                {allRoles.length > 0 && (
                  <SearchSelect
                    value={roleF}
                    onChange={setRoleF}
                    options={[{ value: '', label: 'Mọi vai trò' }, ...allRoles.map((r) => ({ value: r, label: r }))]}
                    placeholder="Mọi vai trò"
                    searchPlaceholder="Tìm vai trò…"
                    ariaLabel="Lọc theo vai trò"
                    className="h-8 flex-1 text-xs"
                  />
                )}
                {allTeams.length > 0 && (
                  <SearchSelect
                    value={teamF}
                    onChange={setTeamF}
                    options={[{ value: '', label: 'Mọi nhóm' }, ...allTeams.map((t) => ({ value: t, label: t }))]}
                    placeholder="Mọi nhóm"
                    searchPlaceholder="Tìm nhóm…"
                    ariaLabel="Lọc theo nhóm"
                    className="h-8 flex-1 text-xs"
                  />
                )}
              </div>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Người phụ trách">
            {query === '' && (
              <>
                <li>{optRow(value === '', () => pick(''), <><Users className="h-5 w-5 rounded-full bg-surface-2 p-0.5 text-muted" aria-hidden /><span title="Bỏ lọc — hiện việc của tất cả mọi người">Mọi người</span></>)}</li>
                <li>{optRow(value === ASSIGNEE_UNASSIGNED, () => pick(ASSIGNEE_UNASSIGNED), <><UserRound className="h-5 w-5 rounded-full bg-surface-2 p-0.5 text-faint" aria-hidden /><span title="Chỉ hiện việc chưa có ai nhận">Chưa gán</span></>)}</li>
                <li className="my-1 h-px bg-border" aria-hidden />
              </>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                {optRow(value === o.id, () => pick(o.id), (
                  <>
                    <Avatar name={o.name} src={o.avatarUrl} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.name}</span>
                      {(o.position || (o.teams && o.teams.length > 0)) && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                          {o.position && <span className="truncate">{o.position}</span>}
                          {o.teams?.map((t) => (
                            <span
                              key={t.name}
                              className="rounded px-1 py-px text-[10px] font-medium"
                              style={{ backgroundColor: `color-mix(in oklch, ${t.color || 'var(--faint)'} 16%, transparent)`, color: t.color || 'var(--faint)' }}
                            >
                              {t.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </>
                ))}
              </li>
            ))}
            {filtered.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted">Không có ai khớp. Thử từ khoá khác hoặc bỏ bớt bộ lọc vai trò/nhóm.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
