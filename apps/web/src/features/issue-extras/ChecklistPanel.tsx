import { useState } from 'react';
import { CheckSquare, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useChecklist, useAddChecklistItem, useUpdateChecklistItem, useRemoveChecklistItem } from './api';

/** Danh sách bước nhỏ trong một công việc — nhẹ hơn việc con, chỉ để tick cho xong. */
export function ChecklistPanel({ issueId }: { issueId: string }) {
  const canEdit = useAuth((s) => s.can('issue:edit'));
  const { data: items } = useChecklist(issueId);
  const add = useAddChecklistItem(issueId);
  const update = useUpdateChecklistItem(issueId);
  const remove = useRemoveChecklistItem(issueId);
  const [text, setText] = useState('');

  const list = items ?? [];
  const done = list.filter((i) => i.done).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;

  function submit() {
    const v = text.trim();
    if (!v) return;
    setText('');
    add.mutate(v, { onError: (e) => toast.error(apiErrorMessage(e)) });
  }

  // Chưa có mục nào và không có quyền sửa → ẩn hẳn cho gọn.
  if (list.length === 0 && !canEdit) return null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-muted" aria-hidden />
        <h2 className="text-sm font-semibold text-ink-strong" title="Các bước nhỏ để làm xong việc này. Nhẹ hơn việc con — chỉ tick khi hoàn thành, không có người phụ trách hay hạn riêng.">
          Các bước cần làm
        </h2>
        {list.length > 0 && (
          <span className="tabular text-xs text-muted" title={`Đã xong ${done} trên ${list.length} bước`}>{done}/{list.length} · {pct}%</span>
        )}
      </div>

      {list.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2" title={`Đã xong ${done}/${list.length} bước (${pct}%)`}>
          <div className="h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}

      <ul className="mb-2 divide-y divide-border rounded-md border border-border bg-surface">
        {list.map((it) => (
          <li key={it.id} className="flex items-center gap-2.5 px-3 py-2">
            <input
              type="checkbox"
              checked={it.done}
              disabled={!canEdit || update.isPending}
              onChange={(e) => update.mutate({ itemId: it.id, done: e.target.checked }, { onError: (err) => toast.error(apiErrorMessage(err)) })}
              className="h-4 w-4 shrink-0 rounded border-border-strong accent-[var(--primary)]"
              aria-label={`Đánh dấu đã xong: ${it.text}`}
              title={it.done ? 'Đã xong — bỏ tick nếu cần làm lại' : 'Tick khi bước này đã xong'}
            />
            <span className={cn('min-w-0 flex-1 text-sm', it.done ? 'text-faint line-through' : 'text-ink')}>{it.text}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => remove.mutate(it.id, { onError: (err) => toast.error(apiErrorMessage(err)) })}
                aria-label={`Xoá bước "${it.text}"`}
                title="Xoá bước này"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-3 py-3 text-sm text-faint">Chưa có bước nào. Chia việc thành vài bước nhỏ ở ô bên dưới để dễ theo dõi.</li>
        )}
      </ul>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="Thêm một bước, VD: Viết kiểm thử… (Enter để thêm)"
            aria-label="Nội dung bước cần làm"
            className="h-9 text-sm"
          />
          <Button size="sm" variant="secondary" title="Thêm bước vào danh sách" onClick={submit} disabled={!text.trim() || add.isPending}>
            <Plus className="h-4 w-4" /> Thêm bước
          </Button>
        </div>
      )}
    </section>
  );
}
