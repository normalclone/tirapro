import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Plus, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useProjectLabels, useToggleLabel } from './api';

/**
 * Picker nhãn cho chi tiết issue: hiển thị nhãn hiện tại (`issue.labels`) dưới dạng
 * chip màu có thể gỡ, kèm nút "+ Nhãn" mở popover liệt kê nhãn dự án chưa gắn.
 * Gọn gàng, vừa cột phụ (sidebar). Sau mỗi thay đổi, làm mới query issue.
 */
export function IssueLabelsPicker({ issue, inline }: { issue: IssueDto; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: projectLabels } = useProjectLabels(issue.projectId);
  const { attach, detach } = useToggleLabel(issue.id, issue.key, issue.projectId);

  const attachedIds = new Set(issue.labels.map((l) => l.id));
  const available = (projectLabels ?? []).filter((l) => !attachedIds.has(l.id));
  const busy = attach.isPending || detach.isPending;

  async function onAttach(labelId: string) {
    try {
      await attach.mutateAsync(labelId);
      setOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function onDetach(labelId: string, name: string) {
    try {
      await detach.mutateAsync(labelId);
    } catch (e) {
      toast.error(apiErrorMessage(e));
      return;
    }
    toast.success(`Đã gỡ nhãn "${name}"`);
  }

  return (
    <div>
      {!inline && <p className="mb-1.5 text-sm font-medium text-muted">Nhãn</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {issue.labels.map((label) => {
          const color = label.color ?? 'var(--faint)';
          return (
            <span
              key={label.id}
              className="group inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pl-2 pr-1 text-xs font-medium text-ink"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
              <span className="max-w-[10rem] truncate">{label.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDetach(label.id, label.name)}
                aria-label={`Gỡ nhãn ${label.name}`}
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-full text-faint transition-colors',
                  'hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  'disabled:opacity-50',
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Thêm nhãn"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-muted transition-colors',
                'hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              )}
            >
              <Plus className="h-3 w-3" />
              Nhãn
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={6}
              className="z-dropdown w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
              {available.length === 0 ? (
                <p className="px-3 py-3 text-sm text-faint">
                  {(projectLabels ?? []).length === 0 ? 'Dự án chưa có nhãn nào.' : 'Đã gắn hết nhãn.'}
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-label="Nhãn của dự án">
                  {available.map((label) => (
                    <li key={label.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        disabled={busy}
                        onClick={() => void onAttach(label.id)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                          'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
                          'disabled:pointer-events-none disabled:opacity-50',
                        )}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: label.color ?? 'var(--faint)' }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">{label.name}</span>
                        <Tag className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
