import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MutationObserver,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query';
import { roleLabel, type MemberDto, type RoleDto } from '@tirapro/types';
import { api, apiErrorCode, apiErrorMessage } from '@/lib/api';
import { toastReplace } from '@/lib/toastReplace';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuth } from '@/stores/auth';
import { burstBaseline, selfDemoteCopy } from '@/features/members/roleChange';
import { memberErrorText } from '@/features/members/memberErrors';
import { rolePermsMutationOptions, type PermsVars } from '@/features/roles/rolePermsMutation';
import { keys } from '@/lib/queryKeys';
import {
  applyDesired,
  groupState,
  grantAdminCopy,
  grantsAdmin,
  groupTargetOn,
  guardRoleEdit,
  planFlush,
  planPermUndo,
  selfLoss,
  setManyDesired,
  subtractDesired,
  toggleDesired,
  type Desired,
  type GuardCtx,
} from './rolePermEdit';

/** Nhịp gom các lần bấm liên tiếp trên cùng một vai trò thành MỘT PATCH. */
const FLUSH_DELAY_MS = 500;
const UNDO_TOAST_MS = 6000;
const CONFLICT_CODE = 'VERSION_CONFLICT';
const CONFLICT_TOAST = 'Vai trò vừa được người khác sửa — đã tải lại';

type PermsObserver = MutationObserver<RoleDto, unknown, PermsVars, unknown>;

const toastIdOf = (roleId: string) => `role-perms:${roleId}`;

/** Trạng thái "mới nhất" mà các callback bất đồng bộ (timer, toast Hoàn tác) phải đọc — không đóng băng theo lần render. */
interface Live {
  roles: readonly RoleDto[];
  members: readonly MemberDto[] | undefined;
  selfId: string | null;
  selfIsSystemAdmin: boolean;
  /** Đang giữ `workspace:admin` (đã gồm admin hệ thống) — P-C14. */
  callerIsAdmin: boolean;
}

/** Ngữ cảnh chốt quyền thiết yếu từ trạng thái mới nhất. */
function guardCtx(l: Live, roleId: string): GuardCtx {
  return {
    role: { id: roleId },
    roles: l.roles,
    members: l.members,
    selfId: l.selfId,
    selfIsSystemAdmin: l.selfIsSystemAdmin,
    callerIsAdmin: l.callerIsAdmin,
  };
}

/** Bản máy chủ mới nhất của vai trò: ưu tiên cache react-query (đã nạp lại), rơi về props. */
function latestRoleOf(qc: QueryClient, live: Live, roleId: string): RoleDto | undefined {
  for (const [, list] of qc.getQueriesData<RoleDto[]>({ queryKey: keys.roles.all })) {
    const hit = list?.find((r) => r.id === roleId);
    if (hit) return hit;
  }
  return live.roles.find((r) => r.id === roleId);
}

/**
 * Lưu bộ quyền của một vai trò + toast kết quả. Toast nằm ở đây (`mutate` của observer + try/catch), không ở callback từng
 * lần gọi (bị mất khi lần gọi bị thay thế/huỷ gắn). `cancelDraft(roleId)`: bỏ nhịp gom + bản nháp đang chờ của vai trò.
 */
function useRoleSaver(live: { current: Live }, cancelDraft: (roleId: string) => void) {
  const qc = useQueryClient();
  const observers = useRef(new Map<string, PermsObserver>());
  const baselines = useRef(new Map<string, string[]>());
  const toastSeq = useRef(new Map<string, number>());

  const observerFor = useCallback(
    (roleId: string): PermsObserver => {
      let o = observers.current.get(roleId);
      if (!o) {
        o = new MutationObserver(
          qc,
          rolePermsMutationOptions(qc, roleId, (permissionKeys, expectedUpdatedAt) =>
            api
              .patch<RoleDto>(`/roles/${roleId}`, { permissionKeys, expectedUpdatedAt })
              .then((r) => r.data),
          ) as MutationOptions<RoleDto, unknown, PermsVars, unknown>,
        );
        observers.current.set(roleId, o);
      }
      return o;
    },
    [qc],
  );

  /** Gửi `next` (đang từ `prev`). `undo`: lần này là Hoàn tác. */
  const save = useCallback(
    async function save(
      role: RoleDto,
      prev: string[],
      next: string[],
      flags: { undo?: boolean; onOptimistic?: () => void } = {},
    ) {
      const id = role.id;
      const name = roleLabel(role.name);
      const toastId = toastIdOf(id);
      // Bộ máy chủ đã xác nhận TRƯỚC lần lưu này (mốc Hoàn tác đúng kể cả khi lần xếp hàng trước thất bại).
      const got: { before: string[] | null } = { before: null };
      try {
        await observerFor(id).mutate({
          keys: next,
          onOptimistic: flags.onOptimistic,
          onConfirmed: (b) => (got.before = b),
        });
      } catch (e) {
        // Lỗi thay hẳn toast Hoàn tác đang hiện → chuỗi bấm KẾT THÚC: không còn toast nào hứa Hoàn tác.
        baselines.current.delete(id);
        const code = apiErrorCode(e);
        if (code === CONFLICT_CODE) {
          // Bản trong tay đã cũ: bỏ MỌI thay đổi chưa gửi của vai trò này (không giữ phần nào của bản cũ); mutation đã
          // hoàn tác cache + nạp lại bản máy chủ.
          cancelDraft(id);
          toastReplace(toastId, 'error', CONFLICT_TOAST);
        } else {
          toastReplace(toastId, 'error', memberErrorText(code) ?? apiErrorMessage(e));
        }
        return;
      }
      // Quyền của chính mình có thể đã đổi (mình đang giữ vai trò này): nạp lại để trang theo quyền mới ngay.
      const l = live.current;
      if (l.members?.some((m) => m.user.id === l.selfId && m.roles.some((r) => r.id === id))) {
        void useAuth.getState().refreshMe();
      }
      if (flags.undo) {
        baselines.current.delete(id);
        toastReplace(toastId, 'success', `Đã hoàn tác quyền của vai trò "${name}"`);
        return;
      }
      const was = got.before ?? prev;
      const loss = selfLoss(guardCtx(live.current, id), was, next);
      baselines.current.set(id, burstBaseline(baselines.current.get(id) ?? null, was));
      // Tự mất quyền thiết yếu → máy chủ đã thu quyền nên Hoàn tác sẽ bị 403: không hứa.
      const undo = loss ? null : planPermUndo(baselines.current.get(id)!, next);
      const seq = (toastSeq.current.get(id) ?? 0) + 1;
      toastSeq.current.set(id, seq);
      const endBurst = () => {
        if (toastSeq.current.get(id) === seq) baselines.current.delete(id); // chỉ toast MỚI NHẤT kết thúc chuỗi
      };
      toastReplace(toastId, 'success', `Đã lưu quyền của vai trò "${name}"`, {
        duration: UNDO_TOAST_MS,
        description: loss
          ? 'Bạn không còn quyền quản lý thành viên của không gian này.'
          : 'Quyền mới có hiệu lực ngay.',
        onDismiss: endBurst,
        onAutoClose: endBurst,
        action: undo
          ? {
              label: 'Hoàn tác',
              onClick: () => {
                // Bỏ bản nháp đang chờ: Hoàn tác = về đúng bộ trước chuỗi bấm.
                cancelDraft(id);
                const cur = latestRoleOf(qc, live.current, id) ?? role;
                void save(cur, [...cur.permissionKeys], undo.keys, { undo: true });
              },
            }
          : undefined,
      });
    },
    [qc, live, observerFor, cancelDraft],
  );
  return save;
}

/**
 * Chỉnh quyền vai trò tuỳ chỉnh ngay trên ma trận (184). Mỗi vai trò có:
 * - bản nháp cục bộ (`Desired`): ô vừa bấm, hiển thị ngay (thắng bản máy chủ);
 * - nhịp gom ~500 ms: hết nhịp → MỘT PATCH replace-all với bộ = bản máy chủ MỚI NHẤT + các ô đã bấm;
 * - mutation nối tiếp theo vai trò + lạc quan + điều kiện tiên quyết `expectedUpdatedAt` (xem `rolePermsMutation`);
 * - toast "Hoàn tác" khôi phục bộ TRƯỚC CẢ CHUỖI bấm; 409 → bỏ hết thay đổi cũ, nạp lại, báo (xem `useRoleSaver`).
 */
export function useRolePermEditor(input: {
  roles: readonly RoleDto[];
  members: readonly MemberDto[] | undefined;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const selfId = useAuth((s) => s.user?.id ?? null);
  const selfIsSystemAdmin = useAuth((s) => s.user?.isSystemAdmin === true);
  const callerIsAdmin = useAuth((s) => s.can('workspace:admin')); // boolean (đã gồm admin hệ thống)

  const [pending, setPending] = useState<Record<string, Desired>>({});
  const pendingRef = useRef(pending);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const live = useRef<Live>({
    roles: input.roles,
    members: input.members,
    selfId,
    selfIsSystemAdmin,
    callerIsAdmin,
  });
  live.current = {
    roles: input.roles,
    members: input.members,
    selfId,
    selfIsSystemAdmin,
    callerIsAdmin,
  };

  const setDesired = useCallback((roleId: string, next: Desired) => {
    const all = { ...pendingRef.current };
    if (Object.keys(next).length === 0) delete all[roleId];
    else all[roleId] = next;
    pendingRef.current = all;
    setPending(all);
  }, []);

  const cancelDraft = useCallback(
    (roleId: string) => {
      clearTimeout(timers.current.get(roleId));
      timers.current.delete(roleId);
      setDesired(roleId, {});
    },
    [setDesired],
  );
  const save = useRoleSaver(live, cancelDraft);

  const flush = useCallback(
    (roleId: string) => {
      clearTimeout(timers.current.get(roleId));
      timers.current.delete(roleId);
      const desired = pendingRef.current[roleId];
      const role = latestRoleOf(qc, live.current, roleId);
      if (!desired || !role) return;
      const { next, changed } = planFlush(role.permissionKeys, desired);
      const drop = () =>
        setDesired(roleId, subtractDesired(pendingRef.current[roleId] ?? {}, desired));
      if (!changed) return drop();
      const verdict = guardRoleEdit(guardCtx(live.current, roleId), role.permissionKeys, next);
      if (verdict.kind === 'blocked') {
        drop();
        toastReplace('role-perms-blocked', 'error', verdict.reason);
        return;
      }
      void save(role, [...role.permissionKeys], next, { onOptimistic: drop });
    },
    [qc, save, setDesired],
  );

  /** Áp một thay đổi lên bản nháp sau khi qua chốt (chặn / xác nhận). `compute` nhận bản nháp HIỆN TẠI. */
  const apply = useCallback(
    async (role: RoleDto, compute: (base: string[], d: Desired) => Desired) => {
      const roleId = role.id;
      const baseOf = () =>
        latestRoleOf(qc, live.current, roleId)?.permissionKeys ?? role.permissionKeys;
      const cur = pendingRef.current[roleId] ?? {};
      const before = applyDesired(baseOf(), cur);
      const after = applyDesired(baseOf(), compute(baseOf(), cur));
      const verdict = guardRoleEdit(guardCtx(live.current, roleId), before, after);
      if (verdict.kind === 'blocked') {
        toastReplace('role-perms-blocked', 'error', verdict.reason);
        return;
      }
      if (verdict.kind === 'confirm') {
        const ok = await confirm({ ...selfDemoteCopy(verdict.reason), destructive: true });
        if (!ok) return;
      }
      // Bật quyền quản trị cho một vai trò = trao toàn quyền cho mọi người giữ nó: hỏi trước.
      if (grantsAdmin(before, after)) {
        const ok = await confirm({
          ...grantAdminCopy(roleLabel(role.name), role.memberCount ?? 0),
          destructive: true,
        });
        if (!ok) return;
      }
      // Tính lại trên bản nháp/bản máy chủ MỚI NHẤT (có thể đã đổi trong lúc hộp xác nhận mở).
      setDesired(roleId, compute(baseOf(), pendingRef.current[roleId] ?? {}));
      clearTimeout(timers.current.get(roleId));
      timers.current.set(
        roleId,
        setTimeout(() => flush(roleId), FLUSH_DELAY_MS),
      );
    },
    [confirm, flush, qc, setDesired],
  );

  const toggle = useCallback(
    (role: RoleDto, key: string) => apply(role, (base, d) => toggleDesired(base, d, key)),
    [apply],
  );

  /** Bấm ô NHÓM: đủ → tắt cả nhóm; một phần/không → bật cả nhóm (theo `groupKeys` ĐẦY ĐỦ của nhóm). */
  const toggleGroup = useCallback(
    (role: RoleDto, groupKeys: readonly string[]) =>
      apply(role, (base, d) => {
        const eff = applyDesired(base, d);
        const on = groupTargetOn(groupState(groupKeys, (k) => eff.includes(k)).state);
        return setManyDesired(base, d, groupKeys, on);
      }),
    [apply],
  );

  // Rời trang khi còn bản nháp chờ nhịp gom → gửi ngay, đừng mất thay đổi lặng lẽ.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const roleId of [...t.keys()]) flushRef.current(roleId);
    };
  }, []);

  return { pending, toggle, toggleGroup };
}
