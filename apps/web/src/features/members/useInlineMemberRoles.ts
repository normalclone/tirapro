import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberDto } from '@tirapro/types';
import { api, apiErrorCode, apiErrorMessage } from '@/lib/api';
import type { RoleOption } from '@/components/ui/RoleMultiSelect';
import { roleLabel } from '@tirapro/types';
import { memberErrorText } from './memberErrors';
import { memberRolesMutationOptions } from './memberRolesMutation';
import { planUndo } from './roleChange';

const UNDO_TOAST_MS = 6000;

/**
 * Đổi vai trò chung của MỘT thành viên, lưu tức thì + lạc quan (`PUT /members/:userId/roles`), kèm toast "Hoàn tác".
 * Toast nằm ở đây (không ở `mutate(…, { onError })`): `mutateAsync` + try/catch vẫn báo đúng khi hàng bị thay/huỷ gắn.
 * Một toast cho mỗi người (cùng `id`): bấm liên tiếp thì toast được thay, Hoàn tác khôi phục bộ vai trò TRƯỚC lần đổi gần nhất.
 */
export function useInlineMemberRoles(userId: string, personName: string, catalog: RoleOption[]) {
  const qc = useQueryClient();
  const mutation = useMutation(
    memberRolesMutationOptions(qc, userId, (roleIds) =>
      api.put<MemberDto>(`/members/${userId}/roles`, { roleIds }).then((r) => r.data),
    ),
  );
  const toastId = `member-roles:${userId}`;

  /** Lưu `next` (đang từ `prev`). `undo`: lần này là Hoàn tác → không hứa Hoàn tác tiếp. */
  async function change(prev: string[], next: string[], opts: { undo?: boolean } = {}) {
    const refs = next.flatMap((id) => {
      const r = catalog.find((c) => c.id === id);
      return r ? [{ id: r.id, name: r.name, color: r.color }] : [];
    });
    try {
      await mutation.mutateAsync({ roleIds: next, refs });
    } catch (e) {
      toast.error(memberErrorText(apiErrorCode(e), personName) ?? apiErrorMessage(e), {
        id: toastId,
      });
      return;
    }
    if (opts.undo) {
      toast.success(`Đã hoàn tác vai trò của ${personName}`, { id: toastId });
      return;
    }
    const undo = planUndo(prev, next);
    const names = refs.map((r) => roleLabel(r.name)).join(', ');
    toast.success(`Đã đổi vai trò của ${personName}: ${names}`, {
      id: toastId,
      duration: UNDO_TOAST_MS,
      description: 'Quyền mới có hiệu lực ngay.',
      action: undo
        ? { label: 'Hoàn tác', onClick: () => void change(next, undo.roleIds, { undo: true }) }
        : undefined,
    });
  }

  return { change, isPending: mutation.isPending };
}
