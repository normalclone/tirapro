import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, UsersRound } from 'lucide-react';
import type { IssueDto, ProjectSubTeamDto } from '@tirapro/types';
import { cn } from '@/lib/utils';
import { CHIP_TOUCH_HIT } from '@/lib/touchHit';

/**
 * Lọc việc theo TEAM riêng của dự án (người phụ trách thuộc một trong các team đã chọn — hợp các team). Trống = không lọc.
 * Team đã bị xoá khỏi dự án (id còn trong lựa chọn đã lưu) bị bỏ qua; nếu chọn mà không còn team nào hợp lệ thì coi như không lọc.
 */
export function applyTeamFilter<T extends Pick<IssueDto, 'assigneeId'>>(
  issues: T[],
  selected: readonly string[],
  teams: readonly Pick<ProjectSubTeamDto, 'id' | 'members'>[],
): T[] {
  const live = teams.filter((t) => selected.includes(t.id));
  if (live.length === 0) return issues;
  const ids = new Set(live.flatMap((t) => t.members.map((m) => m.id)));
  return issues.filter((i) => !!i.assigneeId && ids.has(i.assigneeId));
}

/** Chip lọc theo team — cùng phong cách với `AssigneeFilter`. Chọn nhiều team được; ẩn nếu dự án chưa có team nào. */
export function TeamFilter({
  teams,
  value,
  onChange,
}: {
  teams: readonly ProjectSubTeamDto[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (teams.length === 0) return null;
  const chosen = teams.filter((t) => value.includes(t.id));
  const active = chosen.length > 0;
  const label = !active
    ? 'Team'
    : chosen.length === 1
      ? chosen[0]!.name
      : `${chosen[0]!.name} +${chosen.length - 1}`;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Lọc theo team"
          title={
            active
              ? `Đang chỉ hiện việc của: ${chosen.map((t) => t.name).join(', ')}. Bấm để đổi hoặc bỏ lọc.`
              : 'Chỉ hiện việc của người trong một hoặc nhiều team của dự án.'
          }
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
            CHIP_TOUCH_HIT,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            active
              ? 'border-transparent bg-primary-subtle text-primary'
              : 'border-border text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          <UsersRound className="h-3.5 w-3.5" aria-hidden />
          <span className="max-w-[9rem] truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-dropdown w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <ul
            role="listbox"
            aria-multiselectable
            aria-label="Team của dự án"
            className="max-h-72 overflow-y-auto"
          >
            {teams.map((t) => {
              const on = value.includes(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2',
                      on && 'bg-surface-2',
                    )}
                  >
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0 text-primary',
                        on ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: t.color ?? 'var(--faint)' }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="text-xs text-faint">{t.memberCount}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-surface-2 hover:text-ink"
            >
              Bỏ lọc team
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
