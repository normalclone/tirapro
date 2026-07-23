import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Clock, Inbox, Repeat2, X, Bug } from 'lucide-react';
import { ReportIssueModal } from '@/features/intake/ReportIssueModal';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { Avatar, Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
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

  const canTriage = useAuth((s) => s.can('issue:triage'));

  const accept = useAccept(projectId ?? '');
  const decline = useDecline(projectId ?? '');
  const snooze = useSnooze(projectId ?? '');

  const navigate = useNavigate();
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <span className="text-sm font-medium text-ink">Phân loại (Triage)</span>
        {inboxCount > 0 && (
          <Badge className="bg-primary-subtle text-primary tabular">{inboxCount}</Badge>
        )}
        <Button size="sm" className="ml-auto" onClick={() => setReportOpen(true)} disabled={!projectId}>
          <Bug className="h-4 w-4" />
          Báo lỗi
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
              description="Không còn issue nào chờ phân loại trong dự án này."
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
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2"
                >
                  {issue.occurrenceCount > 1 && (
                    <span
                      className="tabular inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-xs font-medium text-ink"
                      title={`Lặp lại ${issue.occurrenceCount} lần`}
                    >
                      <Repeat2 className="h-3 w-3" />×{issue.occurrenceCount}
                    </span>
                  )}

                  <span className="shrink-0 font-mono text-xs text-muted">{issue.key}</span>

                  <button
                    type="button"
                    onClick={() => navigate(`/issue/${issue.key}`)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink-strong hover:underline"
                    title={issue.summary}
                  >
                    {issue.summary}
                  </button>

                  {issue.severity && (
                    <span
                      className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium sm:inline-flex"
                      style={{
                        color: issue.severity.color ?? 'var(--ink)',
                        background: issue.severity.color ? `color-mix(in oklch, ${issue.severity.color} 14%, transparent)` : 'var(--surface-2)',
                      }}
                      title={`Mức độ: ${issue.severity.name}`}
                    >
                      {issue.severity.name}
                    </span>
                  )}

                  {issue.priority && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: issue.priority.color ?? 'var(--faint)' }}
                      title={`Ưu tiên: ${issue.priority.name}`}
                    />
                  )}

                  <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted md:inline">
                    {issue.type.name}
                  </span>

                  <span className="shrink-0">
                    {issue.assignee && (
                      <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size={22} />
                    )}
                  </span>

                  {canTriage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onAccept(issue)}
                        disabled={pending}
                        title="Nhận issue vào dự án"
                      >
                        <Check className="h-4 w-4" />
                        Nhận
                      </Button>

                      <div className="relative">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSnoozingId(snoozingId === issue.id ? null : issue.id)}
                          disabled={pending}
                          aria-haspopup="menu"
                          aria-expanded={snoozingId === issue.id}
                          title="Tạm hoãn"
                        >
                          <Clock className="h-4 w-4" />
                          Tạm hoãn
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
                        title="Từ chối issue"
                      >
                        <X className="h-4 w-4" />
                        Từ chối
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

      {projectId && (
        <ReportIssueModal projectKey={key} projectId={projectId} open={reportOpen} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}
