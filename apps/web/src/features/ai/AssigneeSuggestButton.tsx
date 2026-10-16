import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Sparkles } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/ui/primitives';
import { DelayedSpinner } from '@/components/ui/primitives';
import { useSuggestAssignee } from './api';
import { AiFallbackNote } from './AiFallbackNote';

/**
 * Nút "Gợi ý" cạnh ô chọn người phụ trách: hỏi máy chủ top 3 người phù hợp (kèm lý do),
 * bấm một người để gán. Việc gán do `onPick` xử lý (dùng đúng luồng sửa issue có kiểm phiên bản).
 */
export function AssigneeSuggestButton({
  projectId,
  issueId,
  disabled,
  onPick,
}: {
  projectId: string;
  issueId: string;
  disabled?: boolean;
  onPick: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const suggest = useSuggestAssignee();

  function load() {
    suggest.reset();
    suggest.mutate({ projectId, issueId });
  }

  const data = suggest.data;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Gợi ý người nên nhận việc này dựa trên kinh nghiệm xử lý việc tương tự và khối lượng đang làm"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-primary hover:bg-primary-subtle disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:min-h-9"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Gợi ý
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-72 rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          {suggest.isPending && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted">
              <DelayedSpinner /> Đang phân tích…
            </div>
          )}
          {suggest.isError && (
            <div className="space-y-2 p-2 text-sm">
              <p className="text-danger">{apiErrorMessage(suggest.error)}</p>
              <button type="button" onClick={load} className="text-primary hover:underline">
                Thử lại
              </button>
            </div>
          )}
          {data && data.suggestions.length === 0 && (
            <p className="p-3 text-sm text-muted">Dự án chưa có thành viên nào để gợi ý.</p>
          )}
          {data && data.suggestions.length > 0 && (
            <>
              <ul className="space-y-1">
                {data.suggestions.map((s) => (
                  <li key={s.userId}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onPick(s.userId);
                      }}
                      className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-surface-2"
                    >
                      <Avatar name={s.displayName} src={s.avatarUrl} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-ink-strong">
                            {s.displayName}
                          </span>
                          <span className="shrink-0 text-xs text-muted" title="Mức độ phù hợp">
                            {Math.round(s.score * 100)}%
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {s.reasons.slice(0, 2).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.source === 'heuristic' && data.reason ? (
                <AiFallbackNote reason={data.reason} variant="footnote" />
              ) : (
                <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] text-faint">
                  {data.source === 'claude'
                    ? 'Xếp hạng bởi AI dựa trên số liệu của dự án.'
                    : 'Gợi ý theo số liệu dự án.'}
                </p>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
