import { useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useCachedProjectIssue, useUpdateIssue } from '@/features/issues/api';
import { useMoveToSprint } from '@/features/backlog/api';
import { useDeleteIssue } from '@/features/issue-edit/api';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useIssueTransitions } from '../useIssueTransitions';
import {
  finishIssueAction,
  useIssueActionStore,
  type IssueAction,
  type IssueActionRequest,
} from './issueActions';
import { recordIssueChange, recordIssueDeleted } from './issueOverlay';

/** Bản mới nhất của việc (cache danh sách dự án) để gửi đúng `version` (OCC); không có thì dùng bản của dòng lúc bấm. */
function useLatest(issue: IssueDto): IssueDto {
  const { data } = useCachedProjectIssue(issue.projectId, (list) =>
    list.find((i) => i.id === issue.id),
  );
  return data && data.version >= issue.version ? data : issue;
}

/**
 * Chạy MỘT lần sau khi runner đã dựng xong — hoãn sang macrotask thay vì chạy ngay trong effect gắn kết: ở StrictMode (dev)
 * effect chạy–dọn–chạy lại ngay, và một mutation khởi động trong lượt đầu mất người nghe (observer bị gỡ khi dọn) nên
 * `isPending`/callback từng lần gọi không bao giờ tới. Timer của lượt đầu bị huỷ lúc dọn, lượt sau đặt lại → đúng một lần.
 */
function useOnce(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = window.setTimeout(() => ref.current(), 0);
    return () => window.clearTimeout(t);
  }, []);
}

/** Cửa sổ Hoàn tác của toast đổi trạng thái (xem `transitionToastOptions`): runner còn sống tới hết khoảng này. */
const UNDO_WINDOW_MS = 8_000;
/** Chốt chặn: runner không bao giờ treo vô hạn dù luồng bị bỏ dở (vd hộp hỏi đóng bằng cách không báo). */
const SAFETY_MS = 60_000;

/** Báo `done` sau `ms` (và dọn khi runner bị gỡ). */
function useDoneAfter(done: () => void) {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(done, ms);
  };
}

/**
 * Đổi trạng thái: đi đúng cổng `requestTransition` của trang chi tiết (hộp Cách giải quyết/lý do, toast Hoàn tác). Runner
 * sống tới khi hộp bị huỷ, hoặc hết cửa sổ Hoàn tác sau khi chuyển xong (Hoàn tác chạy bằng mutation của runner này). Kết quả
 * máy chủ (kể cả khi Hoàn tác) được ghi vào lớp phủ Bộ lọc ngay trong `useTransitionDetail`.
 */
function TransitionRunner({
  issue,
  toStatusId,
  done,
}: {
  issue: IssueDto;
  toStatusId: string;
  done: () => void;
}) {
  const latest = useLatest(issue);
  const t = useIssueTransitions(latest);
  const schedule = useDoneAfter(done);
  const sawPending = useRef(false);
  const sawDialog = useRef(false);
  useOnce(() => {
    t.requestTransition(toStatusId);
    schedule(SAFETY_MS);
  });
  useEffect(() => {
    if (t.dialogOpen) sawDialog.current = true;
    if (t.isPending) {
      sawPending.current = true;
    } else if (sawPending.current) {
      schedule(UNDO_WINDOW_MS); // xong (thành công hay lỗi): giữ cho tới hết cửa sổ Hoàn tác
    } else if (sawDialog.current && !t.dialogOpen) {
      done(); // hộp bị huỷ, chưa chuyển gì
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phản ứng khi trạng thái hộp/chuyển đổi đổi
  }, [t.isPending, t.dialogOpen]);
  return <>{t.dialog}</>;
}

function PriorityRunner({
  issue,
  priority,
  priorityName,
  done,
}: {
  issue: IssueDto;
  priority: IssueDto['priority'];
  priorityName: string;
  done: () => void;
}) {
  const latest = useLatest(issue);
  const patch = useUpdateIssue(issue.projectId, { silent: true });
  useOnce(() => {
    void (async () => {
      try {
        const res = await patch.mutateAsync({
          id: latest.id,
          key: latest.key,
          patch: { priorityId: priority?.id ?? null },
          version: latest.version,
        });
        // Bản của máy chủ nếu có; không thì phần vá lạc quan (phủ lên kết quả Bộ lọc).
        recordIssueChange(
          isIssue(res?.data) ? res.data : { id: latest.id, version: latest.version + 1, priority },
        );
        toast.success(`Đã đặt mức ưu tiên ${priorityName} cho ${latest.key}`, { duration: 2000 });
      } catch (e) {
        toast.error(apiErrorMessage(e));
      } finally {
        done();
      }
    })();
  });
  return null;
}

/** Phản hồi có dạng một việc (id + version) — phân biệt với thân rỗng/lạ. */
const isIssue = (x: unknown): x is IssueDto =>
  !!x &&
  typeof (x as { id?: unknown }).id === 'string' &&
  typeof (x as { version?: unknown }).version === 'number';

function AssignMeRunner({ issue, done }: { issue: IssueDto; done: () => void }) {
  const latest = useLatest(issue);
  const me = useAuth((s) => s.user);
  const patch = useUpdateIssue(issue.projectId, { silent: true });
  useOnce(() => {
    if (!me || latest.assigneeId === me.id) {
      done();
      return;
    }
    void (async () => {
      try {
        const res = await patch.mutateAsync({
          id: latest.id,
          key: latest.key,
          patch: { assigneeId: me.id },
          version: latest.version,
        });
        recordIssueChange(
          isIssue(res?.data)
            ? res.data
            : {
                id: latest.id,
                version: latest.version + 1,
                assigneeId: me.id,
                assignee: me,
              },
        );
        toast.success('Đã giao việc này cho bạn', { duration: 2000 });
      } catch (e) {
        toast.error(apiErrorMessage(e));
      } finally {
        done();
      }
    })();
  });
  return null;
}

function SprintRunner({
  issue,
  sprintId,
  sprintName,
  done,
}: {
  issue: IssueDto;
  sprintId: string | null;
  sprintName: string;
  done: () => void;
}) {
  const latest = useLatest(issue);
  const move = useMoveToSprint(issue.projectId, { silent: true });
  useOnce(() => {
    void (async () => {
      try {
        const res = await move.mutateAsync({ id: latest.id, sprintId, version: latest.version });
        recordIssueChange(
          isIssue(res) ? res : { id: latest.id, version: latest.version + 1, sprintId },
        );
        toast.success(sprintId ? `Đã chuyển sang ${sprintName}` : 'Đã đưa về Việc chờ', {
          duration: 1800,
        });
      } catch (e) {
        toast.error(apiErrorMessage(e));
      } finally {
        done();
      }
    })();
  });
  return null;
}

/** Trả focus về phần tử đã mở menu nếu focus đang rơi về `body` (Radix không tự làm được vì menu đã biến mất lúc hộp mở). */
function restoreFocus(el: HTMLElement | null | undefined) {
  if (!el) return;
  const fix = () => {
    const a = document.activeElement;
    if (el.isConnected && (!a || a === document.body)) el.focus({ preventScroll: true });
  };
  window.setTimeout(fix, 0);
  window.setTimeout(fix, 320); // sau hiệu ứng đóng của hộp (Radix trả focus về phần tử cũ ở đó)
}

/** Xoá: hộp xác nhận dùng chung (`useConfirm`, không gõ lại tên — RC2), rồi xoá như ở trang chi tiết. */
function DeleteRunner({
  issue,
  returnFocus,
  done,
}: {
  issue: IssueDto;
  returnFocus?: HTMLElement | null;
  done: () => void;
}) {
  const confirm = useConfirm();
  const remove = useDeleteIssue();
  const peek = useIssuePeek();
  const peekRef = useRef(peek);
  peekRef.current = peek;
  useOnce(() => {
    void (async () => {
      try {
        const ok = await confirm({
          title: `Xoá công việc ${issue.key}?`,
          description:
            'Công việc sẽ biến mất khỏi bảng và mọi danh sách. Dữ liệu vẫn được giữ lại phía hệ thống — nhờ quản trị khôi phục nếu bạn xoá nhầm.',
          confirmLabel: 'Xoá công việc',
          destructive: true,
        });
        if (!ok) {
          restoreFocus(returnFocus);
          return;
        }
        try {
          await remove.mutateAsync({ id: issue.id, key: issue.key, projectId: issue.projectId });
          recordIssueDeleted(issue.id);
          if (peekRef.current.peekKey === issue.key) peekRef.current.close();
          toast.success(`Đã xoá công việc ${issue.key}`);
        } catch (e) {
          toast.error(apiErrorMessage(e));
          restoreFocus(returnFocus);
        }
      } finally {
        done();
      }
    })();
  });
  return null;
}

function Runner({ req }: { req: IssueActionRequest }): ReactNode {
  const done = () => finishIssueAction(req.seq);
  const action: IssueAction = req;
  switch (action.kind) {
    case 'transition':
      return <TransitionRunner issue={action.issue} toStatusId={action.toStatusId} done={done} />;
    case 'priority':
      return (
        <PriorityRunner
          issue={action.issue}
          priority={action.priority}
          priorityName={action.priorityName}
          done={done}
        />
      );
    case 'assignMe':
      return <AssignMeRunner issue={action.issue} done={done} />;
    case 'sprint':
      return (
        <SprintRunner
          issue={action.issue}
          sprintId={action.sprintId}
          sprintName={action.sprintName}
          done={done}
        />
      );
    case 'delete':
      return <DeleteRunner issue={action.issue} returnFocus={action.returnFocus} done={done} />;
  }
}

/**
 * Mount MỘT lần ở khung ứng dụng (cạnh `ConfirmHost`): thực hiện hành động ghi do menu công việc yêu cầu. Mỗi yêu cầu có
 * runner riêng (key = số thứ tự) nên hai hành động liên tiếp không gạt nhau (toast thành công/Hoàn tác của hành động
 * trước vẫn còn), và runner tự gỡ khi xong việc để không giữ hook theo dự án mãi.
 */
export function IssueActionHost(): ReactNode {
  const runs = useIssueActionStore((s) => s.runs);
  return (
    <>
      {runs.map((req) => (
        <Runner key={req.seq} req={req} />
      ))}
    </>
  );
}
