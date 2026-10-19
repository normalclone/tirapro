import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useCachedProjectIssue, useUpdateIssue } from '@/features/issues/api';
import { useMoveToSprint } from '@/features/backlog/api';
import { useDeleteIssue } from '@/features/issue-edit/api';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import { useIssueTransitions } from '../useIssueTransitions';
import { useIssueActionStore, type IssueActionRequest } from './issueActions';

/** Bản mới nhất của việc (cache danh sách dự án) để gửi đúng `version` (OCC); không có thì dùng bản của dòng lúc bấm. */
function useLatest(issue: IssueDto): IssueDto {
  const { data } = useCachedProjectIssue(issue.projectId, (list) =>
    list.find((i) => i.id === issue.id),
  );
  return data && data.version >= issue.version ? data : issue;
}

/** Danh sách kết quả bộ lọc/JQL nằm ở cache riêng (`/search`): làm mới để dòng đổi theo. */
const refreshSearch = (qc: QueryClient) =>
  void qc.invalidateQueries({ queryKey: keys.search.all, refetchType: 'active' });

/** Chạy MỘT lần khi dựng (chống chạy đôi do StrictMode). */
function useOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- một lần theo yêu cầu (key = seq)
  }, []);
}

/** Đổi trạng thái: đi đúng cổng `requestTransition` của trang chi tiết (hộp Cách giải quyết/lý do, toast Hoàn tác). */
function TransitionRunner({ issue, toStatusId }: { issue: IssueDto; toStatusId: string }) {
  const latest = useLatest(issue);
  const t = useIssueTransitions(latest);
  const qc = useQueryClient();
  useOnce(() => t.requestTransition(toStatusId));
  useEffect(() => {
    if (!t.isPending) refreshSearch(qc);
  }, [t.isPending, qc]);
  return <>{t.dialog}</>;
}

function PriorityRunner({
  issue,
  priorityId,
  priorityName,
}: {
  issue: IssueDto;
  priorityId: string | null;
  priorityName: string;
}) {
  const latest = useLatest(issue);
  const patch = useUpdateIssue(issue.projectId, { silent: true });
  const qc = useQueryClient();
  useOnce(() => {
    void (async () => {
      try {
        await patch.mutateAsync({
          id: latest.id,
          key: latest.key,
          patch: { priorityId },
          version: latest.version,
        });
        toast.success(`Đã đặt mức ưu tiên ${priorityName} cho ${latest.key}`, { duration: 2000 });
        refreshSearch(qc);
      } catch (e) {
        toast.error(apiErrorMessage(e));
      }
    })();
  });
  return null;
}

function AssignMeRunner({ issue }: { issue: IssueDto }) {
  const latest = useLatest(issue);
  const me = useAuth((s) => s.user);
  const patch = useUpdateIssue(issue.projectId, { silent: true });
  const qc = useQueryClient();
  useOnce(() => {
    if (!me || latest.assigneeId === me.id) return;
    void (async () => {
      try {
        await patch.mutateAsync({
          id: latest.id,
          key: latest.key,
          patch: { assigneeId: me.id },
          version: latest.version,
        });
        toast.success('Đã giao việc này cho bạn', { duration: 2000 });
        refreshSearch(qc);
      } catch (e) {
        toast.error(apiErrorMessage(e));
      }
    })();
  });
  return null;
}

function SprintRunner({
  issue,
  sprintId,
  sprintName,
}: {
  issue: IssueDto;
  sprintId: string | null;
  sprintName: string;
}) {
  const latest = useLatest(issue);
  const move = useMoveToSprint(issue.projectId, { silent: true });
  useOnce(() => {
    void (async () => {
      try {
        await move.mutateAsync({ id: latest.id, sprintId, version: latest.version });
        toast.success(sprintId ? `Đã chuyển sang ${sprintName}` : 'Đã đưa về Việc chờ', {
          duration: 1800,
        });
      } catch (e) {
        toast.error(apiErrorMessage(e));
      }
    })();
  });
  return null;
}

/** Xoá: hộp xác nhận dùng chung (`useConfirm`, không gõ lại tên — RC2), rồi xoá như ở trang chi tiết. */
function DeleteRunner({ issue }: { issue: IssueDto }) {
  const confirm = useConfirm();
  const remove = useDeleteIssue();
  const peek = useIssuePeek();
  const peekRef = useRef(peek);
  peekRef.current = peek;
  const qc = useQueryClient();
  useOnce(() => {
    void (async () => {
      const ok = await confirm({
        title: `Xoá công việc ${issue.key}?`,
        description:
          'Công việc sẽ biến mất khỏi bảng và mọi danh sách. Dữ liệu vẫn được giữ lại phía hệ thống — nhờ quản trị khôi phục nếu bạn xoá nhầm.',
        confirmLabel: 'Xoá công việc',
        destructive: true,
      });
      if (!ok) return;
      try {
        await remove.mutateAsync({ id: issue.id, key: issue.key, projectId: issue.projectId });
        if (peekRef.current.peekKey === issue.key) peekRef.current.close();
        toast.success(`Đã xoá công việc ${issue.key}`);
        refreshSearch(qc);
      } catch (e) {
        toast.error(apiErrorMessage(e));
      }
    })();
  });
  return null;
}

function Runner({ req }: { req: IssueActionRequest }): ReactNode {
  switch (req.kind) {
    case 'transition':
      return <TransitionRunner issue={req.issue} toStatusId={req.toStatusId} />;
    case 'priority':
      return (
        <PriorityRunner
          issue={req.issue}
          priorityId={req.priorityId}
          priorityName={req.priorityName}
        />
      );
    case 'assignMe':
      return <AssignMeRunner issue={req.issue} />;
    case 'sprint':
      return <SprintRunner issue={req.issue} sprintId={req.sprintId} sprintName={req.sprintName} />;
    case 'delete':
      return <DeleteRunner issue={req.issue} />;
  }
}

/**
 * Mount MỘT lần ở khung ứng dụng (cạnh `ConfirmHost`): thực hiện hành động ghi do menu công việc yêu cầu. Mỗi yêu cầu
 * dựng một runner riêng (key = số thứ tự) nên hook theo dự án của việc đó sống đến khi có yêu cầu kế tiếp — đủ để hộp
 * Cách giải quyết/toast Hoàn tác còn nguyên sau khi menu đã đóng.
 */
export function IssueActionHost(): ReactNode {
  const req = useIssueActionStore((s) => s.current);
  return req ? <Runner key={req.seq} req={req} /> : null;
}
