import { useState } from 'react';
import { CheckCircle2, MinusCircle, PlayCircle, XCircle } from 'lucide-react';
import type { AutomationRunStepDto, RuleRunStatus } from '@tirapro/types';
import { Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { QueryError } from '@/components/ui/QueryError';
import { cn } from '@/lib/utils';
import { useRuleRuns, useTestRule, type AutomationRule } from './rules-api';
import { LOCALE } from '@/lib/locale';

const STATUS: Record<RuleRunStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  SUCCESS: { label: 'Thành công', cls: 'text-success', Icon: CheckCircle2 },
  SKIPPED: { label: 'Bỏ qua', cls: 'text-muted', Icon: MinusCircle },
  FAILED: { label: 'Lỗi', cls: 'text-danger', Icon: XCircle },
};

const time = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function Steps({ log }: { log: AutomationRunStepDto[] }) {
  if (!log.length) return <p className="text-xs text-faint">Không có chi tiết.</p>;
  return (
    <ol className="space-y-0.5">
      {log.map((s, i) => (
        <li key={i} className="flex gap-2 text-xs">
          <span
            className={cn(
              'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
              s.ok ? 'bg-success' : 'bg-danger',
            )}
            aria-hidden
          />
          <span className="min-w-0 break-words text-muted">
            <span className="font-medium text-ink">{s.step}</span>
            {s.message ? ` — ${s.message}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Chạy thử trên một công việc (không áp dụng gì) + lịch sử các lần chạy gần đây của quy tắc. */
export function RuleRunLog({ rule }: { rule: AutomationRule }) {
  const { data, isLoading, isError, error, refetch } = useRuleRuns(rule.id);
  const test = useTestRule(rule.id);
  const [issueKey, setIssueKey] = useState('');

  return (
    <div className="space-y-4 border-t border-border bg-bg px-5 py-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (issueKey.trim()) test.mutate(issueKey.trim());
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`test-${rule.id}`} className="mb-1 block text-xs font-medium text-muted">
            Chạy thử trên công việc
          </label>
          <Input
            id={`test-${rule.id}`}
            value={issueKey}
            onChange={(e) => setIssueKey(e.target.value)}
            placeholder="Mã công việc, ví dụ DEMO-TASK-1"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={test.isPending}
          disabled={!issueKey.trim()}
          title="Chỉ mô phỏng — không thay đổi gì trên công việc"
        >
          <PlayCircle className="h-4 w-4" /> Chạy thử
        </Button>
      </form>

      {test.data && (
        <div className="rounded-md border border-border bg-surface p-3" role="status">
          <p className={cn('mb-1.5 text-sm font-medium', STATUS[test.data.status].cls)}>
            Kết quả chạy thử: {STATUS[test.data.status].label}{' '}
            <span className="font-normal text-faint">(chưa áp dụng thay đổi nào)</span>
          </p>
          <Steps log={test.data.log} />
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Lần chạy gần đây
        </h3>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : isError ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : !data?.length ? (
          <p className="text-sm text-muted">Quy tắc này chưa chạy lần nào.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {data.map((run) => {
              const st = STATUS[run.status];
              return (
                <li key={run.id} className="px-3 py-2.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                    <st.Icon className={cn('h-4 w-4', st.cls)} aria-hidden />
                    <span className={cn('font-medium', st.cls)}>{st.label}</span>
                    {run.issueKey && (
                      <span className="font-mono text-xs text-ink">{run.issueKey}</span>
                    )}
                    <span className="ml-auto text-xs text-faint">
                      {time(run.createdAt)} · {run.durationMs} ms
                    </span>
                  </div>
                  <Steps log={run.log} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
