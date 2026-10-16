import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Inbox, Bug } from 'lucide-react';
import { useReportIssueModal } from '@/stores/reportIssue';
import { toast } from 'sonner';
import type { TriageItemDto } from '@tirapro/types';
import { useProject } from '@/features/projects/api';
import { Badge, DelayedSpinner, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { useCanIn } from '@/features/projects/permissions';
import { PeekShell } from '@/features/issues/peek/PeekShell';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { useAccept, useDecline, useSnooze, useTriageCount, useTriageInbox } from './api';
import { DeclineDialog } from './DeclineDialog';
import { TriageRow } from './TriageRow';
import type { AcceptPayload } from './triageLogic';

const DAY_MS = 86_400_000;

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
  // Giữ `declining` sau khi đóng để hộp kịp chạy hiệu ứng đóng (và nhớ lý do đang gõ nếu mở lại cùng việc).
  const [declining, setDeclining] = useState<TriageItemDto | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);

  const inboxCount = count?.count ?? issues?.length ?? 0;

  function onAccept(issue: TriageItemDto, payload: AcceptPayload) {
    accept.mutate(
      { issueId: issue.id, ...payload },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () =>
          toast.success(`Đã nhận ${issue.key} vào Việc chờ`, {
            duration: 4000,
            action: { label: 'Mở', onClick: () => peek.open(issue.key) },
          }),
      },
    );
  }

  function onDecline(issue: TriageItemDto, reason: string) {
    decline.mutate(
      { issueId: issue.id, version: issue.version, reason },
      {
        onError: (e) => toast.error(apiErrorMessage(e)),
        onSuccess: () => {
          setDeclineOpen(false);
          toast.success(`Đã từ chối ${issue.key} — người gửi sẽ nhận được lý do`, {
            duration: 4000,
          });
        },
      },
    );
  }

  function onSnooze(issue: TriageItemDto, days: number, label: string) {
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
          <span className="text-sm font-medium text-ink">Việc mới vào</span>
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

        <div className="flex-1 overflow-y-auto pb-24">
          {inbox.isError ? (
            <div className={pageContainer('md')}>
              <QueryError error={inbox.error} onRetry={() => inbox.refetch()} />
            </div>
          ) : isLoading ? (
            <div className={pageContainer('md', 'space-y-2')}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
              <DelayedSpinner />
            </div>
          ) : !issues || issues.length === 0 ? (
            <div className={pageContainer('md')}>
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title="Hộp phân loại trống — mọi yêu cầu đã được xử lý"
                description="Đây là nơi tiếp nhận công việc do người ngoài dự án báo lên. Hiện không còn việc nào chờ bạn duyệt."
              />
            </div>
          ) : (
            <div className={pageContainer('md')}>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {issues.map((issue) => (
                  <TriageRow
                    key={issue.id}
                    issue={issue}
                    projectKey={key}
                    compact={compact}
                    peeking={peek.peekKey === issue.key}
                    canTriage={canTriage}
                    pending={accept.isPending || decline.isPending || snooze.isPending}
                    onPeek={peek.open}
                    onAccept={onAccept}
                    onDecline={(i) => {
                      setDeclining(i);
                      setDeclineOpen(true);
                    }}
                    onSnooze={onSnooze}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {declining && (
        <DeclineDialog
          key={declining.id}
          open={declineOpen}
          issueKey={declining.key}
          projectId={declining.projectId}
          loading={decline.isPending}
          onCancel={() => setDeclineOpen(false)}
          onConfirm={(reason) => onDecline(declining, reason)}
        />
      )}
    </PeekShell>
  );
}
