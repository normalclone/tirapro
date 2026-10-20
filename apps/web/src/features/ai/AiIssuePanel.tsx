import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { AiFallbackNote } from './AiFallbackNote';
import { AiSourceChips } from './AiSourceChips';
import { aiSourceLabel } from './fallbackNote';
import { useAiCapabilities, useSuggestIssue, useSummarizeIssue } from './api';

/**
 * "Đang phân tích…" + nút Huỷ thật (focus được ngay khi bắt đầu). Huỷ chỉ ngừng chờ phía client — nói rõ trong `title`
 * rằng yêu cầu đã gửi vẫn có thể tính vào hạn mức AI.
 */
export function SuggestProgress({
  onCancel,
  cancelRef,
}: {
  onCancel: () => void;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">
      <span>Đang phân tích…</span>
      <Button
        ref={cancelRef}
        type="button"
        size="sm"
        variant="ghost"
        title="Dừng chờ kết quả — yêu cầu đã gửi tới AI vẫn có thể tính vào hạn mức"
        onClick={onCancel}
      >
        Huỷ
      </Button>
    </div>
  );
}

/** `onPeek`: mở xem nhanh khi bấm một nguồn (màn không có xem nhanh thì bỏ trống → điều hướng thường). */
export function AiIssuePanel({
  issueId,
  onPeek,
}: {
  issueId: string;
  onPeek?: (key: string) => void;
}) {
  const { data: capabilities } = useAiCapabilities();
  const summarize = useSummarizeIssue();
  const suggest = useSuggestIssue(issueId, (e) => toast.error(apiErrorMessage(e)));
  const suggestBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(false);

  // Bắt đầu: nút "Gợi ý" bị vô hiệu → đưa focus sang Huỷ; kết thúc/huỷ: trả focus về "Gợi ý" nếu focus đã rơi ra body.
  useEffect(() => {
    if (suggest.pending) cancelBtn.current?.focus();
    else if (wasPending.current) {
      const a = document.activeElement;
      if (!a || a === document.body) suggestBtn.current?.focus();
    }
    wasPending.current = suggest.pending;
  }, [suggest.pending]);

  const summary = summarize.data;
  const suggestion = suggest.data;

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-ink">Trợ lý AI</span>
        {capabilities?.available === false && (
          <span className="ml-auto text-xs text-faint">chế độ cơ bản</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={summarize.isPending}
          onClick={() =>
            summarize.mutate(issueId, {
              onError: (e) => toast.error(apiErrorMessage(e)),
            })
          }
        >
          Tóm tắt
        </Button>
        <Button
          ref={suggestBtn}
          size="sm"
          variant="secondary"
          loading={suggest.pending}
          onClick={suggest.run}
        >
          Gợi ý ưu tiên & điểm
        </Button>
      </div>

      {suggest.pending && <SuggestProgress onCancel={suggest.cancel} cancelRef={cancelBtn} />}

      {summary && (
        <div>
          <div className="mt-3 whitespace-pre-wrap rounded-md bg-surface-2 p-2.5 text-sm text-ink">
            {summary.summary}
          </div>
          <p className="mt-1 text-xs text-faint">
            Nguồn: {aiSourceLabel(summary.source, summary.reason)}
          </p>
          <AiFallbackNote reason={summary.reason} variant="plain" />
        </div>
      )}

      {suggestion && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {suggestion.priority && (
              <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-xs text-primary">
                Ưu tiên: {suggestion.priority}
              </span>
            )}
            {typeof suggestion.storyPoints === 'number' && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink">
                {suggestion.storyPoints} điểm
              </span>
            )}
            {suggestion.assigneeHint && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink">
                {suggestion.assigneeHint}
              </span>
            )}
          </div>
          {suggestion.rationale && (
            <p className="mt-2 text-sm text-muted">{suggestion.rationale}</p>
          )}
          <AiSourceChips sources={suggestion.sources} onPeek={onPeek} />
          <p className="mt-2 text-xs text-faint">
            Nguồn: {aiSourceLabel(suggestion.source, suggestion.reason)}
          </p>
          <AiFallbackNote reason={suggestion.reason} variant="plain" />
        </div>
      )}
    </div>
  );
}
