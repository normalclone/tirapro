import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Clock, Inbox, Repeat2, X, Bug } from 'lucide-react';
import { useReportIssueModal } from '@/stores/reportIssue';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { Avatar, Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { SeverityBadge } from '@/components/ui/SeverityBadge';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { useCanIn } from '@/features/projects/permissions';
import { PeekShell } from '@/features/issues/peek/PeekShell';
import { IssueKeyLink } from '@/features/issues/peek/IssueKeyLink';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { rowPeekProps } from '@/features/issues/peek/rowPeekProps';
import { cn } from '@/lib/utils';
import { useAccept, useDecline, useSnooze, useTriageCount, useTriageInbox } from './api';

const DAY_MS = 86_400_000;
const SNOOZE_CHOICES: { label: string; days: number }[] = [
  { label: '1 ngày', days: 1 },
  { label: '3 ngày', days: 3 },
  { label: '1 tuần', days: 7 },
];

export function TriagePage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const projectId = project?.id;

  const inbox = useTriageInbox(projectId);
  const { data: issues, isLoading } = inbox;
  const { data: count } = useTriageCount(projectId);

  const canTriage = useCanIn(projectId)('issue:triage');

  const accept = useAccept(projectId ?? '');
  const decline = useDecline(projectId ?? '');
  const snooze = useSnooze(projectId ?? '');

  const peek = useIssuePeek();
  // Panel mở → cột danh sách hẹp: bỏ chip phụ, nút chỉ còn biểu tượng (tên nút vẫn có cho trình đọc màn hình + tooltip).
  const compact = !!peek.peekKey;
  const [snoozingId, setSnoozingId] = useState<string | null>(null);

  const inboxCount = count?.count ?? issues?.length ?? 0;

  function onAccept(issue: IssueDto) {
    accept.mutate(
      { issueId: issue.id, version: issue.version },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () => toast.success(`Đã nhận ${issue.key}`, { duration: 2500 }),
      },
    );
  }

  function onDecline(issue: IssueDto) {
    decline.mutate(
      { issueId: issue.id, version: issue.version },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () => toast.success(`Đã từ chối ${issue.key}`, { duration: 2500 }),
      },
    );
  }

  function onSnooze(issue: IssueDto, days: number, label: string) {
    setSnoozingId(null);
    const until = new Date(Date.now() + days * DAY_MS).toISOString();
    snooze.mutate(
      { issueId: issue.id, version: issue.version, until },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () => toast.success(`Tạm hoãn ${issue.key} · ${label}`, { duration: 2500 }),
      },
    );
  }

  return (
    <PeekShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          <span className="text-sm font-medium text-ink">Phân loại (Triage)</span>
          {inboxCount > 0 && (
            <Badge className="bg-primary-subtle text-primary tabular">{inboxCount}</Badge>
          )}
          <Button
            size="sm"
            className="ml-auto"
            onClick={() =>
              useReportIssueModal.getState().openReport({ projectKey: key, kind: 'BUG' })
            }
            disabled={!projectId}
          >
            <Bug className="h-4 w-4" />
            Gửi yêu cầu
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {inbox.isError ? (
            <div className={pageContainer('sm')}>
              <QueryError error={inbox.error} onRetry={() => inbox.refetch()} />
            </div>
          ) : isLoading ? (
            <div className={pageContainer('sm', 'space-y-2')}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
              <DelayedSpinner />
            </div>
          ) : !issues || issues.length === 0 ? (
            <div className={pageContainer('sm')}>
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title="Hộp phân loại trống — tất cả đã được xử lý 🎉"
                description="Đây là nơi tiếp nhận công việc do người ngoài dự án báo lên. Hiện không còn việc nào chờ bạn duyệt."
              />
            </div>
          ) : (
            <div className={pageContainer('sm')}>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {issues.map((issue) => {
                  const pending = accept.isPending || decline.isPending || snooze.isPending;
                  return (
                    <li
                      key={issue.id}
                      tabIndex={0}
                      data-issue-key={issue.key}
                      aria-label={`Xem nhanh ${issue.key}: ${issue.summary}`}
                      {...rowPeekProps(issue.key, peek.open)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                        peek.peekKey === issue.key && 'bg-primary-subtle/60',
                      )}
                    >
                      {issue.occurrenceCount > 1 && (
                        <span
                          className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink"
                          title={`Lặp lại ${issue.occurrenceCount} lần`}
                        >
                          <Repeat2 className="h-3 w-3" />×{issue.occurrenceCount}
                        </span>
                      )}

                      <IssueKeyLink issueKey={issue.key} onPeek={peek.open} />

                      <span
                        className="min-w-0 flex-1 truncate text-left text-sm text-ink-strong"
                        title={issue.summary}
                      >
                        {issue.summary}
                      </span>

                      {!compact && (
                        <SeverityBadge
                          severity={issue.severity}
                          className="hidden sm:inline-flex"
                        />
                      )}

                      {issue.priority && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: issue.priority.color ?? 'var(--faint)' }}
                          title={`Ưu tiên: ${issue.priority.name}`}
                        />
                      )}

                      {!compact && (
                        <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted md:inline">
                          {issue.type.name}
                        </span>
                      )}

                      <span className="shrink-0">
                        {issue.assignee && (
                          <Avatar
                            name={issue.assignee.displayName}
                            src={issue.assignee.avatarUrl}
                            size={22}
                          />
                        )}
                      </span>

                      {canTriage && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => onAccept(issue)}
                            disabled={pending}
                            title="Nhận công việc này vào dự án"
                          >
                            <Check className="h-4 w-4" />
                            <span className={compact ? 'sr-only' : undefined}>Nhận</span>
                          </Button>

                          <div className="relative">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setSnoozingId(snoozingId === issue.id ? null : issue.id)
                              }
                              disabled={pending}
                              aria-haspopup="menu"
                              aria-expanded={snoozingId === issue.id}
                              title="Tạm hoãn"
                            >
                              <Clock className="h-4 w-4" />
                              <span className={compact ? 'sr-only' : undefined}>Tạm hoãn</span>
                            </Button>
                            {snoozingId === issue.id && (
                              <>
                                <button
                                  type="button"
                                  className="fixed inset-0 z-10 cursor-default"
                                  aria-label="Đóng"
                                  onClick={() => setSnoozingId(null)}
                                />
                                <div
                                  role="menu"
                                  data-state="open"
                                  className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
                                >
                                  {SNOOZE_CHOICES.map((c) => (
                                    <button
                                      key={c.days}
                                      type="button"
                                      role="menuitem"
                                      onClick={() => onSnooze(issue, c.days, c.label)}
                                      className="block w-full px-3 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                                    >
                                      {c.label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDecline(issue)}
                            disabled={pending}
                            className="text-muted hover:text-ink"
                            title="Từ chối công việc này"
                          >
                            <X className="h-4 w-4" />
                            <span className={compact ? 'sr-only' : undefined}>Từ chối</span>
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </PeekShell>
  );
}
