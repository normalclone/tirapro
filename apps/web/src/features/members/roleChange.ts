import type { MemberDto, PermissionKey, RoleRefDto } from '@tirapro/types';

/** Quyền quyết định "quản trị workspace" — cùng khoá máy chủ dùng để chặn hạ quản trị viên cuối cùng. */
const WORKSPACE_ADMIN: PermissionKey = 'workspace:admin';

export const LAST_ADMIN_REASON =
  'Đây là quản trị viên cuối cùng — hãy cấp quyền quản trị cho người khác trước khi bỏ vai trò này';

/** Quyền thao tác trang Thành viên (cùng khoá `PUT /members/:userId/roles` đòi). */
const MEMBER_MANAGE: PermissionKey = 'member:manage';

/** Id các vai trò có quyền `key`. */
export function roleIdsWith(
  roles: readonly { id: string; permissionKeys: PermissionKey[] }[],
  key: PermissionKey,
): Set<string> {
  return new Set(roles.filter((r) => r.permissionKeys.includes(key)).map((r) => r.id));
}

/** Id các vai trò có quyền quản trị workspace. */
export function adminRoleIds(roles: readonly { id: string; permissionKeys: PermissionKey[] }[]) {
  return roleIdsWith(roles, WORKSPACE_ADMIN);
}

/** Id các vai trò có quyền quản lý thành viên. */
export function manageRoleIds(roles: readonly { id: string; permissionKeys: PermissionKey[] }[]) {
  return roleIdsWith(roles, MEMBER_MANAGE);
}

/** Hai bộ vai trò bằng nhau như tập hợp (bỏ qua thứ tự). */
export function sameRoleSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * `userId` là quản trị workspace CUỐI CÙNG? Phản chiếu `assertNotLastWorkspaceAdmin` ở máy chủ: người này đang giữ vai
 * trò admin VÀ không còn ai KHÁC (tài khoản chưa bị vô hiệu hoá) giữ vai trò admin.
 */
export function isLastAdmin(
  members: readonly MemberDto[],
  userId: string,
  adminIds: ReadonlySet<string>,
): boolean {
  const holdsAdmin = (m: MemberDto) => m.roles.some((r) => adminIds.has(r.id));
  const me = members.find((m) => m.user.id === userId);
  if (!me || !holdsAdmin(me)) return false;
  return !members.some(
    (m) => m.user.id !== userId && m.user.status !== 'DEACTIVATED' && holdsAdmin(m),
  );
}

/**
 * Vai trò không được bỏ chọn kèm lý do (cho `RoleChecklist`): admin cuối cùng chỉ còn MỘT vai trò admin đang chọn thì
 * khoá vai trò đó (bỏ đi là mất toàn bộ quyền admin → máy chủ sẽ từ chối).
 */
export function lockedRoleReasons(
  currentIds: readonly string[],
  adminIds: ReadonlySet<string>,
  lastAdmin: boolean,
): Record<string, string> {
  if (!lastAdmin) return {};
  const held = currentIds.filter((id) => adminIds.has(id));
  return held.length === 1 ? { [held[0]!]: LAST_ADMIN_REASON } : {};
}

export type RoleChangePlan =
  | { kind: 'noop' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'confirm'; next: string[]; canUndo: boolean; reason: 'admin' | 'manage' }
  | { kind: 'apply'; next: string[]; canUndo: boolean };

/**
 * Quyết định việc làm với một lần bật/tắt vai trò: không đổi/rỗng → bỏ qua; hạ quản trị viên cuối cùng → chặn (lý do);
 * TỰ mất quyền admin/quản lý thành viên của mình → hỏi xác nhận; còn lại lưu ngay.
 * `canUndo`: false khi người thao tác tự mất quyền — máy chủ đã thu quyền nên Hoàn tác sẽ bị 403.
 */
export function planRoleChange(input: {
  prev: readonly string[];
  next: string[];
  adminIds: ReadonlySet<string>;
  manageIds?: ReadonlySet<string>;
  lastAdmin: boolean;
  isSelf: boolean;
}): RoleChangePlan {
  const { prev, next, adminIds, lastAdmin, isSelf } = input;
  const manageIds = input.manageIds ?? new Set<string>();
  if (next.length === 0 || sameRoleSet(prev, next)) return { kind: 'noop' };
  const loses = (ids: ReadonlySet<string>) =>
    prev.some((id) => ids.has(id)) && !next.some((id) => ids.has(id));
  const losesAdmin = loses(adminIds);
  if (losesAdmin && lastAdmin) return { kind: 'blocked', reason: LAST_ADMIN_REASON };
  if (isSelf && (losesAdmin || loses(manageIds)))
    return { kind: 'confirm', next, canUndo: false, reason: losesAdmin ? 'admin' : 'manage' };
  return { kind: 'apply', next, canUndo: true };
}

/** Lời nhắc của hộp xác nhận khi TỰ mất quyền: nói đúng thứ sắp mất (admin hay chỉ quản lý thành viên). */
export function selfDemoteCopy(reason: 'admin' | 'manage'): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  if (reason === 'admin')
    return {
      title: 'Bỏ quyền quản trị của chính bạn?',
      description:
        'Sau khi bỏ, bạn không thể tự cấp lại quyền quản trị — cần một quản trị viên khác cấp cho bạn.',
      confirmLabel: 'Bỏ quyền quản trị',
    };
  return {
    title: 'Bỏ quyền quản lý thành viên của chính bạn?',
    description:
      'Sau khi bỏ, bạn không thể tự đổi vai trò của ai nữa (kể cả của chính mình) — cần người có quyền này cấp lại cho bạn.',
    confirmLabel: 'Bỏ quyền quản lý',
  };
}

/**
 * Baseline của một chuỗi bấm: bộ vai trò TRƯỚC lần đổi đầu tiên khi toast còn hiện. Hoàn tác khôi phục về đây
 * (không chỉ lần bấm cuối). Đã có baseline thì giữ nguyên.
 */
export function burstBaseline(
  baseline: readonly string[] | null,
  prev: readonly string[],
): string[] {
  return [...(baseline ?? prev)];
}

/** Kế hoạch Hoàn tác: khôi phục bộ `before`; `null` khi không có gì khác hoặc bộ trước rỗng (máy chủ bắt buộc ≥ 1). */
export function planUndo(
  before: readonly string[],
  after: readonly string[],
): { roleIds: string[] } | null {
  if (before.length === 0 || sameRoleSet(before, after)) return null;
  return { roleIds: [...before] };
}

/** Cache danh sách thành viên với vai trò của `userId` thay bằng `roles` (lạc quan). Các hàng khác giữ nguyên tham chiếu. */
export function applyRolesToMembers(
  members: MemberDto[] | undefined,
  userId: string,
  roles: RoleRefDto[],
): MemberDto[] | undefined {
  return members?.map((m) => (m.user.id === userId ? { ...m, roles } : m));
}

/**
 * Theo dõi các lần lưu nối tiếp theo từng người: `confirmed` = bộ vai trò máy chủ đã xác nhận gần nhất (gieo từ cache
 * trước lần bấm ĐẦU của người đó); `pending` = số lần lưu chưa xong. Lỗi chỉ hoàn tác ở lần cuối còn lại, về `confirmed`
 * (ảnh chụp lạc quan có thể là trạng thái chưa từng được lưu).
 */
export interface RoleSaveEntry {
  confirmed: RoleRefDto[];
  pending: number;
}
export type RoleSaveStates = Map<string, RoleSaveEntry>;

export function beginSave(states: RoleSaveStates, userId: string, cacheRoles: RoleRefDto[]): void {
  const st = states.get(userId) ?? { confirmed: cacheRoles, pending: 0 };
  st.pending += 1;
  states.set(userId, st);
}

export function succeedSave(states: RoleSaveStates, userId: string, roles: RoleRefDto[]): void {
  const st = states.get(userId);
  if (st) st.confirmed = roles;
}

/** Vai trò cần hoàn về nếu đây là lần lưu cuối còn lại của người này; ngược lại `null` (lần sau sẽ định đoạt). */
export function failSave(states: RoleSaveStates, userId: string): RoleRefDto[] | null {
  const st = states.get(userId);
  return st && st.pending <= 1 ? st.confirmed : null;
}

export function endSave(states: RoleSaveStates, userId: string): void {
  const st = states.get(userId);
  if (!st) return;
  st.pending -= 1;
  if (st.pending <= 0) states.delete(userId);
}
