import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import type { MemberDto, RoleRefDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { registerSessionCleaner } from '@/lib/sessionCache';
import { queryClient } from '@/lib/queryClient';
import {
  applyRolesToMembers,
  beginSave,
  endSave,
  failSave,
  succeedSave,
  type RoleSaveEntry,
  type RoleSaveStates,
} from './roleChange';

export interface RolesVars {
  roleIds: string[];
  /** Vai trò tương ứng `roleIds` (để vẽ ngay trong cache trước khi máy chủ trả lời). */
  refs: RoleRefDto[];
}

/** Context: bản đồ theo dõi mà lần này ĐÃ tăng `pending` (null = `onMutate` thoát sớm, không tăng). */
interface Ctx {
  states: RoleSaveStates | null;
}

const memberRolesMutationKey = (userId: string) => ['member-roles', 'inline', userId] as const;

const allStates = new WeakMap<QueryClient, RoleSaveStates>();
const statesOf = (qc: QueryClient): RoleSaveStates => {
  let m = allStates.get(qc);
  if (!m) allStates.set(qc, (m = new Map<string, RoleSaveEntry>()));
  return m;
};
/** Đổi phiên (đăng xuất / đổi workspace): bỏ theo dõi cũ; lần lưu đang chạy giữ bản đồ CŨ trong context nên không ghi nhầm. */
registerSessionCleaner(() => allStates.delete(queryClient));

const liveStates = (qc: QueryClient, ctx: Ctx | undefined) =>
  ctx?.states && allStates.get(qc) === ctx.states ? ctx.states : undefined;

/**
 * Mutation lưu vai trò tức thì cho MỘT thành viên, có cập nhật lạc quan:
 * - `scope` theo người: các lần lưu của cùng một người chạy NỐI TIẾP đúng thứ tự bấm → lần bấm cuối thắng.
 * - `onMutate` vẽ ngay vai trò mới vào cache; lỗi chỉ hoàn tác ở lần cuối còn lại, về giá trị máy chủ đã xác nhận.
 * - `onSettled`: chỉ nạp lại (và làm mới quyền) khi đây là lần cuối còn chạy.
 * Toast do nơi gọi lo (`mutateAsync` + try/catch) nên `meta.silent` tắt toast lỗi chung.
 */
export function memberRolesMutationOptions(
  qc: QueryClient,
  userId: string,
  send: (roleIds: string[]) => Promise<MemberDto>,
): MutationOptions<MemberDto, unknown, RolesVars, Ctx> {
  const key = memberRolesMutationKey(userId);
  return {
    mutationKey: key,
    scope: { id: `member-roles:${userId}` },
    meta: { silent: true },
    mutationFn: ({ roleIds }) => send(roleIds),
    onMutate: async ({ refs }) => {
      await qc.cancelQueries({ queryKey: keys.members.workspace });
      const cur = qc.getQueryData<MemberDto[]>(keys.members.workspace);
      const mine = cur?.find((m) => m.user.id === userId);
      if (!cur || !mine) return { states: null };
      const states = statesOf(qc);
      beginSave(states, userId, mine.roles);
      qc.setQueryData(keys.members.workspace, applyRolesToMembers(cur, userId, refs));
      return { states };
    },
    onSuccess: (member, _vars, ctx) => {
      const states = liveStates(qc, ctx);
      if (states) succeedSave(states, userId, member.roles);
    },
    onError: (_e, _vars, ctx) => {
      const states = liveStates(qc, ctx);
      const revert = states ? failSave(states, userId) : null;
      if (!revert) return; // còn lần sau cho người này, hoặc phiên đã đổi / không áp gì lạc quan
      qc.setQueryData<MemberDto[]>(keys.members.workspace, (cur) =>
        applyRolesToMembers(cur, userId, revert),
      );
    },
    onSettled: (_d, _e, _vars, ctx) => {
      const states = liveStates(qc, ctx);
      if (states) endSave(states, userId);
      if (qc.isMutating({ mutationKey: key }) <= 1) {
        void qc.invalidateQueries({ queryKey: keys.members.workspace });
        void qc.invalidateQueries({ queryKey: keys.users.workspace });
        void qc.invalidateQueries({ queryKey: keys.projects.permissionsAll });
      }
    },
  };
}
