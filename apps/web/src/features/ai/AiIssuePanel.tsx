import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { useAiCapabilities, useSuggestIssue, useSummarizeIssue } from './api';

function sourceLabel(source: 'claude' | 'heuristic'): string {
  return source === 'claude' ? 'Claude' : 'gợi ý cơ bản';
}

export function AiIssuePanel({ issueId }: { issueId: string }) {
  const { data: capabilities } = useAiCapabilities();
  const summarize = useSummarizeIssue();
  const suggest = useSuggestIssue();

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
          size="sm"
          variant="secondary"
          loading={suggest.isPending}
          onClick={() =>
            suggest.mutate(issueId, {
              onError: (e) => toast.error(apiErrorMessage(e)),
            })
          }
        >
          Gợi ý ưu tiên & điểm
        </Button>
      </div>

      {summary && (
        <div>
          <div className="mt-3 whitespace-pre-wrap rounded-md bg-surface-2 p-2.5 text-sm text-ink">
            {summary.summary}
          </div>
          <p className="mt-1 text-xs text-faint">Nguồn: {sourceLabel(summary.source)}</p>
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
          <p className="mt-1 text-xs text-faint">Nguồn: {sourceLabel(suggestion.source)}</p>
        </div>
      )}
    </div>
  );
}
