import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { writeClipboard } from '@/lib/copyText';
import type { IssueDto } from '@tirapro/types';
import { useProjectMeta } from '@/features/ai/api';
import { useProjects } from '@/features/projects/api';
import { useWorkflows } from '@/features/workflow-settings/api';
import { apiErrorMessage } from '@/lib/api';
import { useTransitionDetail } from './api';
import { computeNextStatuses } from './nextStatuses';
import { transitionToastOptions } from './statusUndo';
import { TransitionDialog, type DialogTransitionKind } from './TransitionDialog';
import { defaultResolutionId, transitionKind } from './transitionKind';

interface PendingTransition {
  seq: number;
  toStatusId: string;
  kind: DialogTransitionKind;
  fromName: string;
  toName: string;
  toLabel: string;
}

/**
 * Bước chuyển trạng thái kế tiếp của một công việc + hàm đổi trạng thái (toast kèm Hoàn tác khi hợp lệ).
 * Dùng chung cho trang chi tiết và panel xem nhanh để hai nơi không lệch hành vi.
 *
 * `requestTransition` là cổng chung cho nút, phím 1..9 và Cmd+K: vào Done / mở lại / trả lại → hộp hỏi
 * (Cách giải quyết, lý do) — hộp dựng sẵn ở `dialog`, nơi gọi chỉ việc render; còn lại chạy thẳng.
 * `changeStatus` luôn chạy thẳng (không hỏi).
 */
export function useIssueTransitions(issue: IssueDto | undefined) {
  const { data: workflows } = useWorkflows();
  const transition = useTransitionDetail(issue?.projectId ?? '');
  const { data: projects } = useProjects(true);
  const projectKey = projects?.find((p) => p.id === issue?.projectId)?.key;
  const { data: meta, isError: metaError } = useProjectMeta(projectKey);
  const resolutions = meta?.resolutions ?? [];

  // Hộp Cách giải quyết / Lý do: `pending` giữ nội dung kể cả khi đang đóng (để hiệu ứng đóng chạy), `dialogOpen` điều khiển mở.
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Đổi sang việc khác (Back/Forward, mở từ Cmd+K, bấm dòng khác trong panel…) → bỏ hộp đang mở, kẻo xác nhận nhầm sang việc mới.
  useEffect(() => {
    setDialogOpen(false);
    setPending(null);
    setWaitingMeta(null);
  }, [issue?.id]);

  // Vào Done khi meta dự án chưa tải (chưa biết có Cách giải quyết nào): chờ meta rồi mới quyết hỏi hay chạy thẳng,
  // không để chạy thẳng vì `resolutions` còn rỗng (vd phím 1..9 ngay sau khi mở trang trực tiếp).
  const [waitingMeta, setWaitingMeta] = useState<string | null>(null);
  useEffect(() => {
    if (waitingMeta && meta) {
      setWaitingMeta(null);
      requestTransition(waitingMeta);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chạy lại khi meta về; `requestTransition` đọc state mới nhất của render này
  }, [meta, waitingMeta]);
  // Meta không tải được, hoặc việc đã đổi trạng thái trong lúc chờ → bỏ lượt chờ (không chạy một chuyển trạng thái cũ).
  useEffect(() => {
    if (waitingMeta && metaError) {
      setWaitingMeta(null);
      toast.error('Không tải được thông tin dự án — hãy thử đổi trạng thái lại.');
    }
  }, [waitingMeta, metaError]);
  const statusIdNow = issue?.status.id;
  useEffect(() => setWaitingMeta(null), [statusIdNow]);

  // Chỉ các trạng thái ở BƯỚC KẾ TIẾP — chuyển tiếp hợp lệ từ trạng thái hiện tại theo workflow.
  const currentStatusId = issue?.status.id;
  const nextStatuses = useMemo(
    () => computeNextStatuses(workflows, currentStatusId),
    [workflows, currentStatusId],
  );

  function changeStatus(
    toStatusId: string,
    extra?: { resolutionId?: string; comment?: string },
    /** Hộp thoại chỉ đóng khi thành công — lỗi (409…) giữ hộp mở cùng chữ đã gõ. */
    onDone?: () => void,
  ) {
    if (!issue || toStatusId === issue.status.id) return;
    const toName = nextStatuses.find((s) => s.id === toStatusId)?.name;
    const from = { statusId: issue.status.id, statusName: issue.status.name };
    transition.mutate(
      {
        id: issue.id,
        key: issue.key,
        toStatusId,
        version: issue.version,
        statusName: toName,
        ...extra,
      },
      {
        onSuccess: (updated) => {
          onDone?.();
          // Hoàn tác (nếu có) quay về trạng thái cũ; khi rời Done máy chủ tự xoá Resolution, còn hoàn tác vào lại Done thì
          // máy chủ gán lại mặc định (có thể khác lựa chọn trước đó) — chấp nhận.
          toast.success(
            toName ? `Đã chuyển sang “${toName}”` : 'Đã đổi trạng thái',
            transitionToastOptions({ workflows, from, toStatusId, updated, transition }),
          );
          // Máy chủ đã chuyển nhưng không lưu được lý do thành bình luận: nói rõ và cho chép lại để không mất chữ.
          if (extra?.comment && updated.reasonSaved === false) {
            const text = extra.comment;
            toast.error('Đã chuyển trạng thái nhưng chưa ghi được lý do thành bình luận', {
              duration: 12000,
              action: {
                label: 'Chép lý do',
                onClick: () => void writeClipboard(text),
              },
            });
          }
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  /** Vào Done mà workspace chưa có Cách giải quyết nào → chạy thẳng (máy chủ không có gì để gán). */
  function requestTransition(toStatusId: string) {
    if (!issue || toStatusId === issue.status.id) return;
    const to = nextStatuses.find((s) => s.id === toStatusId);
    const wf = (workflows ?? []).find((w) => w.statuses.some((s) => s.id === issue.status.id));
    const from = wf?.statuses.find((s) => s.id === issue.status.id);
    const kind = to && from ? transitionKind(from, to) : 'forward';
    if (kind === 'close' && !meta) {
      toast.info('Đang tải thông tin dự án… sẽ chuyển ngay khi xong.');
      setWaitingMeta(toStatusId);
      return;
    }
    if (kind === 'forward' || !to || (kind === 'close' && resolutions.length === 0)) {
      changeStatus(toStatusId);
      return;
    }
    setPending({
      seq: Date.now(),
      toStatusId,
      kind,
      fromName: issue.status.name,
      toName: to.name,
      toLabel: to.label,
    });
    setDialogOpen(true);
  }

  const dialog: ReactNode =
    issue && pending ? (
      <TransitionDialog
        key={pending.seq}
        open={dialogOpen}
        kind={pending.kind}
        issueKey={issue.key}
        projectId={issue.projectId}
        fromName={pending.fromName}
        toName={pending.toName}
        toLabel={pending.toLabel}
        resolutions={resolutions}
        defaultResolutionId={defaultResolutionId(resolutions)}
        loading={transition.isPending}
        onConfirm={(v) => changeStatus(pending.toStatusId, v, () => setDialogOpen(false))}
        onCancel={() => setDialogOpen(false)}
      />
    ) : null;

  return {
    nextStatuses,
    changeStatus,
    requestTransition,
    dialog,
    dialogOpen,
    isPending: transition.isPending,
  };
}
