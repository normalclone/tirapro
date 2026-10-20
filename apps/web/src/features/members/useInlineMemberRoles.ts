import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberDto } from '@tirapro/types';
import { api, apiErrorCode, apiErrorMessage } from '@/lib/api';
import type { RoleOption } from '@/components/ui/RoleMultiSelect';
import { roleLabel } from '@tirapro/types';
import { memberErrorText } from './memberErrors';
import { memberRolesMutationOptions } from './memberRolesMutation';
import { useAuth } from '@/stores/auth';
import { burstBaseline, planUndo } from './roleChange';

const UNDO_TOAST_MS = 6000;

/**
 * Đổi vai trò chung của MỘT thành viên, lưu tức thì + lạc quan (`PUT /members/:userId/roles`), kèm toast "Hoàn tác".
 * Toast nằm ở đây (không ở `mutate(…, { onError })`): `mutateAsync` + try/catch vẫn báo đúng khi hàng bị thay/huỷ gắn.
 * Một toast cho mỗi người (cùng `id`): bấm liên tiếp thì toast được thay; Hoàn tác khôi phục bộ vai trò TRƯỚC CẢ CHUỖI
 * bấm (baseline giữ tới khi toast đóng/hết hạn). Tự đổi vai trò của mình xong thì nạp lại quyền (`refreshMe`).
 */
export function useInlineMemberRoles(
  userId: string,
  personName: string,
  catalog: RoleOption[],
  opts: { isSelf: boolean; focusTrigger: () => void },
) {
  const qc = useQueryClient();
  const mutation = useMutation(
    memberRolesMutationOptions(qc, userId, (roleIds) =>
      api.put<MemberDto>(`/members/${userId}/roles`, { roleIds }).then((r) => r.data),
    ),
  );
  const toastId = `member-roles:${userId}`;
  const baseline = useRef<string[] | null>(null);
  const toastSeq = useRef(0);

  /** Lưu `next` (đang từ `prev`). `undo`: lần này là Hoàn tác. `canUndo: false`: không hứa Hoàn tác (tự mất quyền). */
  async function change(
    prev: string[],
    next: string[],
    flags: { undo?: boolean; canUndo?: boolean } = {},
  ) {
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
    // Quyền của chính mình có thể đã đổi: nạp lại để trang lập tức theo quyền mới (không chờ tải lại trang).
    if (opts.isSelf) void useAuth.getState().refreshMe();
    if (flags.undo) {
      baseline.current = null;
      toast.success(`Đã hoàn tác vai trò của ${personName}`, {
        id: toastId,
        description: undefined,
        action: undefined,
        onDismiss: undefined,
        onAutoClose: undefined,
      });
      opts.focusTrigger(); // popover đã đóng từ lúc bấm toast: trả focus sau khi mọi thứ ổn định
      return;
    }
    const names = refs.map((r) => roleLabel(r.name)).join(', ');
    if (flags.canUndo === false) {
      baseline.current = null; // chuỗi kết thúc: không còn quyền để hoàn tác
      toast.success(`Đã đổi vai trò của ${personName}: ${names}`, {
        id: toastId,
        duration: UNDO_TOAST_MS,
        description: 'Bạn không còn quyền quản lý thành viên của không gian này.',
        // sonner GỘP với toast cũ cùng id: phải ghi đè rõ ràng, nếu không nút Hoàn tác của lần trước còn lại.
        action: undefined,
        onDismiss: undefined,
        onAutoClose: undefined,
      });
      return;
    }
    baseline.current = burstBaseline(baseline.current, prev);
    const undo = planUndo(baseline.current, next);
    const seq = ++toastSeq.current;
    const endBurst = () => {
      if (seq === toastSeq.current) baseline.current = null; // chỉ toast MỚI NHẤT được kết thúc chuỗi
    };
    toast.success(`Đã đổi vai trò của ${personName}: ${names}`, {
      id: toastId,
      duration: UNDO_TOAST_MS,
      description: 'Quyền mới có hiệu lực ngay.',
      onDismiss: endBurst,
      onAutoClose: endBurst,
      action: undo
        ? {
            label: 'Hoàn tác',
            onClick: () => {
              opts.focusTrigger(); // toast biến mất → focus không được rơi về body (gọi lại sau khi lưu xong)
              void change(next, undo.roleIds, { undo: true });
            },
          }
        : undefined,
    });
  }

  return { change, isPending: mutation.isPending };
}
