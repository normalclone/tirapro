import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import type { RoleDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { registerSessionCleaner } from '@/lib/sessionCache';
import { queryClient } from '@/lib/queryClient';
import { invalidateAllRoles } from './api';

export interface PermsVars {
  /** Bộ quyền cuối cùng sẽ gửi (replace-all). */
  keys: string[];
  /** Gọi ngay sau khi bộ quyền mới đã được vẽ vào cache — nơi gọi bỏ bản nháp cục bộ lúc này để không nhấp nháy. */
  onOptimistic?: () => void;
  /**
   * Gọi khi lần lưu THÀNH CÔNG, kèm bộ quyền máy chủ đã xác nhận TRƯỚC lần lưu này (không phải ảnh lạc quan trong cache):
   * mốc đúng cho Hoàn tác khi một lần xếp hàng trước đó thất bại.
   */
  onConfirmed?: (confirmedBefore: string[]) => void;
}

/** Điều máy chủ đã xác nhận gần nhất cho một vai trò. */
interface Confirmed {
  keys: string[];
  updatedAt: string | undefined;
}
interface Entry {
  confirmed: Confirmed;
  pending: number;
}
type States = Map<string, Entry>;

interface Ctx {
  states: States | null;
}

const mutationKey = (roleId: string) => ['role-perms', roleId] as const;

const allStates = new WeakMap<QueryClient, States>();
const statesOf = (qc: QueryClient): States => {
  let m = allStates.get(qc);
  if (!m) allStates.set(qc, (m = new Map<string, Entry>()));
  return m;
};
/** Đổi phiên (đăng xuất / đổi workspace): bỏ theo dõi cũ; lần lưu đang chạy giữ bản đồ CŨ trong context nên không ghi nhầm. */
registerSessionCleaner(() => allStates.delete(queryClient));
const liveStates = (qc: QueryClient, ctx: Ctx | undefined) =>
  ctx?.states && allStates.get(qc) === ctx.states ? ctx.states : undefined;

/** Ghi `permissionKeys` của vai trò vào MỌI biến thể cache vai trò (tất cả / theo phạm vi). */
function writeKeys(qc: QueryClient, roleId: string, permissionKeys: string[]): void {
  qc.setQueriesData<RoleDto[]>({ queryKey: keys.roles.all }, (cur) =>
    cur?.map((r) =>
      r.id === roleId ? { ...r, permissionKeys: permissionKeys as RoleDto['permissionKeys'] } : r,
    ),
  );
}

function findRole(qc: QueryClient, roleId: string): RoleDto | undefined {
  for (const [, list] of qc.getQueriesData<RoleDto[]>({ queryKey: keys.roles.all })) {
    const hit = list?.find((r) => r.id === roleId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Mutation lưu bộ quyền của MỘT vai trò tuỳ chỉnh (replace-all), lạc quan + nối tiếp — cùng mẫu `memberRolesMutationOptions`:
 * - `scope` theo vai trò: các lần lưu của cùng một vai trò chạy NỐI TIẾP đúng thứ tự → lần cuối thắng.
 * - `expectedUpdatedAt` lấy LÚC LƯỢT CHẠY từ kết quả lần trước (không phải bản cache lúc bấm) → các lần xếp hàng không tự gây 409.
 * - Lỗi chỉ hoàn tác ở lần cuối còn lại, về bộ máy chủ ĐÃ XÁC NHẬN (ảnh lạc quan có thể là trạng thái chưa từng được lưu).
 * - `onSettled`: chỉ nạp lại (và làm mới quyền dự án) khi đây là lần cuối còn chạy — 409 cũng đi đường này nên bản mới thay thế.
 * Toast do nơi gọi lo (`mutateAsync` + try/catch) nên `meta.silent` tắt toast lỗi chung.
 */
export function rolePermsMutationOptions(
  qc: QueryClient,
  roleId: string,
  send: (keys: string[], expectedUpdatedAt: string | undefined) => Promise<RoleDto>,
): MutationOptions<RoleDto, unknown, PermsVars, Ctx> {
  const key = mutationKey(roleId);
  return {
    mutationKey: key,
    scope: { id: `role-perms:${roleId}` },
    meta: { silent: true },
    mutationFn: ({ keys: next }) => send(next, statesOf(qc).get(roleId)?.confirmed.updatedAt),
    onMutate: async ({ keys: next, onOptimistic }) => {
      await qc.cancelQueries({ queryKey: keys.roles.all });
      const cur = findRole(qc, roleId);
      if (!cur) return { states: null };
      const states = statesOf(qc);
      const st = states.get(roleId) ?? {
        confirmed: { keys: [...cur.permissionKeys], updatedAt: cur.updatedAt },
        pending: 0,
      };
      st.pending += 1;
      states.set(roleId, st);
      writeKeys(qc, roleId, next);
      onOptimistic?.();
      return { states };
    },
    onSuccess: (role, vars, ctx) => {
      const st = liveStates(qc, ctx)?.get(roleId);
      if (st) {
        vars.onConfirmed?.([...st.confirmed.keys]);
        st.confirmed = { keys: [...role.permissionKeys], updatedAt: role.updatedAt };
      }
      // Ghi bản máy chủ vừa trả vào MỌI biến thể cache: `states` bị xoá ở lần cuối, còn cache giữ `updatedAt` cũ tới khi nạp
      // lại → bó bấm kế tiếp (hoặc hộp thoại sửa vai trò) sẽ gửi bản cũ và bị 409 giả. Còn lần xếp hàng sau thì chỉ đóng
      // dấu `updatedAt` — không ghi đè bộ quyền lạc quan của chúng.
      const last = !st || st.pending <= 1;
      qc.setQueriesData<RoleDto[]>({ queryKey: keys.roles.all }, (cur) =>
        cur?.map((r) =>
          r.id !== roleId ? r : last ? { ...r, ...role } : { ...r, updatedAt: role.updatedAt },
        ),
      );
    },
    onError: (_e, _vars, ctx) => {
      const states = liveStates(qc, ctx);
      const st = states?.get(roleId);
      if (!st || st.pending > 1) return; // còn lần sau cho vai trò này (hoặc phiên đã đổi): lần sau định đoạt
      writeKeys(qc, roleId, st.confirmed.keys);
    },
    onSettled: (_d, _e, _vars, ctx) => {
      const states = liveStates(qc, ctx);
      const st = states?.get(roleId);
      if (states && st) {
        st.pending -= 1;
        if (st.pending <= 0) states.delete(roleId);
      }
      if (qc.isMutating({ mutationKey: key }) <= 1) invalidateAllRoles(qc);
    },
  };
}
