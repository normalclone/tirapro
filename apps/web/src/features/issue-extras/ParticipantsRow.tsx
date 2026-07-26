import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/ui/primitives';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useAssigneeOptions } from '@/features/issue-edit/useAssigneeOptions';
import { useParticipants, useSetParticipants } from './api';

/**
 * Hàng "Người tham gia" trong panel Người liên quan của công việc — nhiều người, ngoài
 * người phụ trách & người tạo. Bấm để mở danh sách chọn (tìm theo tên/vị trí/nhóm).
 */
export function ParticipantsRow({ issueId, projectId }: { issueId: string; projectId: string }) {
  const canEdit = useAuth((s) => s.can('issue:edit'));
  const { data: participants } = useParticipants(issueId);
  const setParticipants = useSetParticipants(issueId);
  const options = useAssigneeOptions(projectId);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = useMemo(() => new Set((participants ?? []).map((p) => p.id)), [participants]);
  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.search.includes(query)) : options;

  function toggle(userId: string) {
    const next = new Set(selected);
    next.has(userId) ? next.delete(userId) : next.add(userId);
    setParticipants.mutate([...next], { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  const list = participants ?? [];

  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted" title="Những người cùng làm hoặc cần theo dõi việc này, ngoài người phụ trách và người tạo">
        Người tham gia
      </span>

      {canEdit ? (
        <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Chọn người tham gia"
              title="Bấm để thêm hoặc bớt người tham gia"
              className="inline-flex max-w-[70%] items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {list.length === 0 ? (
                <span className="flex items-center gap-1 text-faint"><UserPlus className="h-3.5 w-3.5" /> Thêm người</span>
              ) : (
                <>
                  <span className="flex -space-x-1.5">
                    {list.slice(0, 4).map((u) => (
                      <span key={u.id} className="rounded-full ring-2 ring-surface" title={`Người tham gia: ${u.displayName}`}>
                        <Avatar name={u.displayName} src={u.avatarUrl} size={20} />
                      </span>
                    ))}
                  </span>
                  {list.length > 4 && <span className="text-xs text-muted">+{list.length - 4}</span>}
                </>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={4}
              className="z-dropdown w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              <div className="border-b border-border p-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, vị trí hoặc nhóm…" aria-label="Tìm người tham gia" autoFocus className="h-8 text-sm" />
              </div>
              <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable aria-label="Người tham gia">
                {filtered.map((o) => {
                  const on = selected.has(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggle(o.id)}
                        className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2', on && 'bg-surface-2')}
                      >
                        <Check className={cn('mt-1 h-4 w-4 shrink-0 text-primary', on ? 'opacity-100' : 'opacity-0')} aria-hidden />
                        <Avatar name={o.name} src={o.avatarUrl} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{o.name}</span>
                          {o.position && <span className="block truncate text-[11px] text-muted">{o.position}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted">Không có ai khớp. Thử từ khoá khác.</li>}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : list.length === 0 ? (
        <span className="text-faint" title="Chưa có ai tham gia thêm ngoài người phụ trách và người tạo">—</span>
      ) : (
        <span className="flex -space-x-1.5">
          {list.slice(0, 5).map((u) => (
            <span key={u.id} className="rounded-full ring-2 ring-surface" title={u.displayName}>
              <Avatar name={u.displayName} src={u.avatarUrl} size={20} />
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
