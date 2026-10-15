import { Command } from 'cmdk';
import { ArrowRightLeft, Bell, BellOff, MessageSquarePlus, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useIssue, useTransitionDetail, useUpdateIssue } from '@/features/issues/api';
import { computeNextStatuses } from '@/features/issues/nextStatuses';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useToggleWatch, useWatchState } from '@/features/issue-widgets/api';
import { ActionItem } from './ActionItem';
import { FOCUS_COMMENT_EVENT } from './events';

const ICON = 'h-4 w-4 shrink-0 text-muted';

/** Chờ bảng lệnh đóng xong (Radix trả focus về chỗ cũ) rồi mới nhờ trang đưa con trỏ vào ô bình luận. */
function focusCommentBox() {
  window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_COMMENT_EVENT)), 120);
}

/**
 * Nhóm "Công việc này" trong Cmd+K khi đang ở `/issue/:key`: giao cho tôi, đổi trạng thái sang bước kế tiếp,
 * theo dõi / bỏ theo dõi, thêm bình luận. Dùng lại đúng hook của trang chi tiết nên dữ liệu lấy từ cache
 * (không gọi thêm API); chỉ dựng khi đang xem một công việc nên các truy vấn không chạy ở màn khác.
 */
export function IssueContextGroup({
  issueKey,
  runAction,
}: {
  issueKey: string;
  runAction: (fn: () => void) => void;
}) {
  const me = useAuth((s) => s.user);
  const { data: issue } = useIssue(issueKey);
  const { data: workflows } = useWorkflows();
  const updateIssue = useUpdateIssue(issue?.projectId);
  const transition = useTransitionDetail(issue?.projectId);
  const { data: watch } = useWatchState(issue?.id ?? '');
  const toggleWatch = useToggleWatch(issue?.id ?? '');

  if (!issue) return null;
  const nextStatuses = computeNextStatuses(workflows, issue.status.id);

  // Bảng lệnh đóng ngay sau khi chọn nên component này bị gỡ (observer của mutation mất) → callback của `mutate`
  // sẽ không chạy. Dùng mutateAsync + try/catch: promise vẫn chạy tiếp sau khi unmount nên toast vẫn hiện.
  async function assignToMe() {
    if (!issue || !me || issue.assigneeId === me.id) return;
    try {
      await updateIssue.mutateAsync({
        id: issue.id,
        key: issue.key,
        patch: { assigneeId: me.id },
        version: issue.version,
      });
      toast.success('Đã giao việc này cho bạn', { duration: 2000 });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function changeStatus(toStatusId: string, toName: string) {
    if (!issue) return;
    try {
      await transition.mutateAsync({
        id: issue.id,
        key: issue.key,
        toStatusId,
        version: issue.version,
        statusName: toName,
      });
      toast.success(`Đã chuyển sang “${toName}”`, { duration: 2000 });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function toggleWatching(watching: boolean) {
    try {
      // useToggleWatch nhận trạng thái HIỆN TẠI rồi tự đảo.
      await toggleWatch.mutateAsync(watching);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Command.Group
      heading="Công việc này"
      className="text-faint [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint"
    >
      {me && issue.assigneeId !== me.id && (
        <ActionItem
          value={`giao cho toi assign me ${issue.key}`}
          icon={<UserCheck className={ICON} aria-hidden="true" />}
          label="Giao cho tôi"
          onSelect={() => runAction(() => void assignToMe())}
        />
      )}
      {nextStatuses.map((s) => (
        <ActionItem
          key={s.id}
          value={`doi trang thai chuyen ${s.name} ${issue.key}`}
          icon={<ArrowRightLeft className={ICON} aria-hidden="true" />}
          label={`Đổi trạng thái → ${s.name}`}
          onSelect={() => runAction(() => void changeStatus(s.id, s.name))}
        />
      ))}
      {watch && (
        <ActionItem
          value={`${watch.watching ? 'bo theo doi unwatch' : 'theo doi watch'} ${issue.key}`}
          icon={
            watch.watching ? (
              <BellOff className={ICON} aria-hidden="true" />
            ) : (
              <Bell className={ICON} aria-hidden="true" />
            )
          }
          label={watch.watching ? 'Bỏ theo dõi' : 'Theo dõi'}
          onSelect={() => runAction(() => void toggleWatching(watch.watching))}
        />
      )}
      <ActionItem
        value={`them binh luan comment ${issue.key}`}
        icon={<MessageSquarePlus className={ICON} aria-hidden="true" />}
        label="Thêm bình luận"
        onSelect={() => runAction(focusCommentBox)}
      />
    </Command.Group>
  );
}
