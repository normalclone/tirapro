import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import * as Popover from '@radix-ui/react-popover';
import { Sparkles } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import { Avatar } from '@/components/ui/primitives';
import { DelayedSpinner } from '@/components/ui/primitives';
import { useSuggestAssignee } from './api';
import { AiFallbackNote } from './AiFallbackNote';
import { useAssigneeAvailability } from '@/features/resources/useAssigneeAvailability';

/**
 * Nút "Gợi ý" cạnh ô chọn người phụ trách: hỏi máy chủ top 3 người phù hợp (kèm lý do),
 * bấm một người để gán. Việc gán do `onPick` xử lý (dùng đúng luồng sửa issue có kiểm phiên bản).
 */
export function AssigneeSuggestButton({
  projectId,
  issueId,
  dueDate,
  startDate,
  assigneeId,
  disabled,
  onPick,
  className,
}: {
  projectId: string;
  issueId: string;
  /** Hạn / ngày bắt đầu của việc — chọn tuần để hiện "còn trống" (không có → tuần hiện tại). */
  dueDate?: string | null;
  startDate?: string | null;
  /** Người đang phụ trách (nếu có) — số "còn trống" của họ đã gồm việc này (xem chú thích). */
  assigneeId?: string | null;
  disabled?: boolean;
  onPick: (userId: string) => void;
  /** Ghi thêm lên nút (vd `min-h-11` cho dải thuộc tính trên điện thoại). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const suggest = useSuggestAssignee();
  const availability = useAssigneeAvailability({ dueDate, startDate, assigneeId });
  const idBase = useId();

  /** MỌI đổi trạng thái mở/đóng đi qua đây (chọn gợi ý, Esc, bấm ra ngoài…) để truy vấn "còn trống" tắt đúng lúc. */
  function changeOpen(o: boolean) {
    setOpen(o);
    availability.onOpenChange(o);
    if (o) load();
  }

  function load() {
    suggest.reset();
    suggest.mutate({ projectId, issueId });
  }

  const data = suggest.data;

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Gợi ý người nên nhận việc này dựa trên kinh nghiệm xử lý việc tương tự và khối lượng đang làm"
          // Giữ disabled:opacity (không dùng token vô hiệu) — nút chữ ghost không nền: chỉ cần mờ đi.
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-primary hover:bg-primary-subtle disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:min-h-9',
            className,
          )}
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
                {data.suggestions.map((s) => {
                  const hint = availability.hintFor(s.userId);
                  const nameId = `${idBase}-${s.userId}-n`;
                  const reasonId = `${idBase}-${s.userId}-r`;
                  const hintId = `${idBase}-${s.userId}-h`;
                  return (
                    <li key={s.userId}>
                      <button
                        type="button"
                        // Có "còn trống": TÊN là tên truy cập; lý do + còn trống đọc qua mô tả (Task 7).
                        aria-labelledby={hint ? nameId : undefined}
                        aria-describedby={hint ? `${reasonId} ${hintId}` : undefined}
                        onClick={() => {
                          changeOpen(false);
                          onPick(s.userId);
                        }}
                        className="flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-surface-2"
                      >
                        <Avatar name={s.displayName} src={s.avatarUrl} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span
                              id={nameId}
                              className="truncate text-sm font-medium text-ink-strong"
                            >
                              {s.displayName}
                            </span>
                            <span className="shrink-0 text-xs text-muted" title="Mức độ phù hợp">
                              {Math.round(s.score * 100)}%
                            </span>
                          </span>
                          <span id={reasonId} className="mt-0.5 block text-xs text-muted">
                            {s.reasons.slice(0, 2).join(' · ')}
                          </span>
                          {hint && (
                            <span
                              id={hintId}
                              className={cn(
                                'mt-0.5 block text-xs tabular-nums',
                                hint.kind === 'over'
                                  ? 'font-medium text-danger'
                                  : hint.kind === 'full'
                                    ? 'text-warning-ink'
                                    : 'text-muted',
                              )}
                            >
                              {hint.text}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {availability.footerNote && (
                <p className="mt-1 px-2 text-[11px] text-faint">{availability.footerNote}</p>
              )}
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
