import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import type { ProjectMeta } from '@/features/ai/api';
import { useUpdateIssue } from '@/features/issues/api';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import {
  adoptChildrenCopy,
  adoptChildrenRequired,
  epicConversionCopy,
  epicConversionPlan,
  isEpicTypeOption,
} from './epicConversion';

/** Loại việc thường (Story/Task/Bug): không phải Epic, không phải sub-task. */
const isStandardTypeOption = (t: {
  key: string | null;
  hierarchyLevel?: number;
  isSubtask: boolean;
}) => !t.isSubtask && !isEpicTypeOption(t);
import { isEpicIssue } from '@/lib/issueRefs';
import { statusMappingNeeded } from './typeChange';

const DETACH = { epicId: null, parentId: null };

/** Một lần gửi đổi loại: có gỡ Epic/việc cha không, đã xác nhận chuyển việc con chưa, trạng thái đích (đổi quy trình). */
interface Send {
  detach: boolean;
  adopt: boolean;
  /** Sub-task đổi sang loại thường: gỡ `parentId` (chỉ sub-task mới có việc cha — TIRA-BUG-22), giữ Epic nếu cha là Epic. */
  clearParent?: boolean;
  targetStatusId?: string;
}

/** Hộp chọn trạng thái đích (đổi sang loại dùng quy trình khác) — giữ cả lựa chọn gỡ/chuyển đã xác nhận cho lần gửi lại. */
export interface TypeChangeAsk extends Pick<Send, 'detach' | 'adopt' | 'clearParent'> {
  seq: number;
  typeId: string;
  typeName: string;
  suggestedStatusId: string | undefined;
}

/**
 * Đổi loại việc (bộ chọn Loại). Sang Epic: nếu việc đang thuộc Epic/việc cha → HỎI trước rồi MỘT lần gửi vừa đổi loại vừa gỡ
 * `epicId/parentId`; nếu việc có việc con thường, MÁY CHỦ báo số lượng (422 EPIC_ADOPT_CHILDREN_REQUIRED — không đếm từ danh sách nạp)
 * → hỏi xác nhận rồi gửi lại kèm `adoptChildren: true`. Hoàn tác (gửi lại loại + Epic/cha cũ) chỉ khi KHÔNG có việc con chuyển đi
 * — máy chủ chỉ cho gửi thiếu `adoptChildren` khi không có việc con, nên "không gửi adoptChildren" nghĩa là 0 việc con bị chuyển.
 */
export function useIssueTypeChange(
  issue: IssueDto,
  meta: ProjectMeta | undefined,
  projectIssues: IssueDto[] | undefined,
) {
  // Lỗi tự xử lý (422 → hộp trạng thái / xác nhận; còn lại → toast) nên không để thông báo chung hiện thêm một lần nữa.
  const patch = useUpdateIssue(issue.projectId, { silent: true });
  const confirm = useConfirm();
  // `ask` giữ nội dung kể cả khi hộp đang đóng (để hiệu ứng đóng chạy), `askOpen` điều khiển mở.
  const [ask, setAsk] = useState<TypeChangeAsk | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  // Sang việc khác (panel xem nhanh đổi dòng) → bỏ hộp đang mở, kẻo xác nhận nhầm cho việc mới.
  useEffect(() => {
    setAskOpen(false);
    setAsk(null);
  }, [issue.id]);

  const typeName = (id: string) => meta?.issueTypes.find((t) => t.id === id)?.name ?? '';

  function undoToast(version: number) {
    const before = { ...issue };
    toast.success(`Đã đổi ${before.key} thành Epic và gỡ khỏi Epic/việc cha`, {
      duration: 6000,
      action: {
        label: 'Hoàn tác',
        onClick: () =>
          patch.mutate(
            {
              id: before.id,
              key: before.key,
              patch: {
                typeId: before.type.id,
                epicId: before.epicId,
                parentId: before.parentId,
                targetStatusId: before.status.id,
              },
              version,
            },
            { onError: (e) => toast.error(apiErrorMessage(e)) },
          ),
      },
    });
  }

  // Cha là Epic (sub-task gắn thẳng vào Epic) → thành việc của Epic đó (`epicId`); cha thường → chỉ gỡ.
  const parentIssue = issue.parentId
    ? projectIssues?.find((i) => i.id === issue.parentId)
    : undefined;
  const clearParentPatch: { parentId: null; epicId?: string } = {
    parentId: null,
    ...(parentIssue && isEpicIssue(parentIssue) ? { epicId: parentIssue.id } : {}),
  };

  function send(typeId: string, o: Send) {
    patch.mutate(
      {
        id: issue.id,
        key: issue.key,
        patch: {
          typeId,
          ...(o.targetStatusId ? { targetStatusId: o.targetStatusId } : {}),
          ...(o.detach ? DETACH : {}),
          ...(o.clearParent && !o.detach ? clearParentPatch : {}),
          ...(o.adopt ? { adoptChildren: true } : {}),
        },
        version: issue.version,
      },
      {
        onSuccess: (res) => {
          if (o.targetStatusId) setAskOpen(false);
          if (o.detach && !o.adopt) undoToast(res.data.version);
          else if (o.targetStatusId)
            toast.success(`Đã đổi loại và chuyển sang “${res.data.status.name}”`);
        },
        onError: (e) => {
          const children = adoptChildrenRequired(e);
          if (children !== null) {
            void confirm({
              ...adoptChildrenCopy(issue.key, children),
              confirmLabel: 'Chuyển việc con',
            }).then((ok) => {
              if (ok) send(typeId, { ...o, adopt: true });
            });
            return;
          }
          const need = o.targetStatusId ? null : statusMappingNeeded(e);
          if (need) {
            setAsk({
              seq: Date.now(),
              typeId,
              typeName: typeName(typeId),
              suggestedStatusId: need.suggestedStatusId,
              detach: o.detach,
              adopt: o.adopt,
              clearParent: o.clearParent,
            });
            setAskOpen(true);
          } else toast.error(apiErrorMessage(e)); // trong hộp trạng thái: giữ hộp mở để chọn lại
        },
      },
    );
  }

  async function change(typeId: string) {
    if (typeId === issue.type.id) return;
    const target = meta?.issueTypes.find((t) => t.id === typeId);
    const plan =
      target && isEpicTypeOption(target) ? epicConversionPlan(issue, projectIssues ?? []) : null;
    if (plan) {
      const copy = epicConversionCopy(issue.key, plan);
      if (!(await confirm({ ...copy, confirmLabel: 'Đổi thành Epic' }))) return;
    }
    const clearParent =
      !plan && issue.type.isSubtask && !!issue.parentId && !!target && isStandardTypeOption(target);
    send(typeId, { detach: !!plan, adopt: false, clearParent });
  }

  return {
    change,
    ask,
    askOpen,
    closeAsk: () => setAskOpen(false),
    confirmAsk: (targetStatusId: string) =>
      ask &&
      send(ask.typeId, {
        detach: ask.detach,
        adopt: ask.adopt,
        clearParent: ask.clearParent,
        targetStatusId,
      }),
    pending: patch.isPending,
  };
}
