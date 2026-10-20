import { roleLabel, type MemberDto, type PermissionKey } from '@tirapro/types';
import { sameRoleSet } from '@/features/members/roleChange';

/**
 * Logic thuần của ma trận quyền chỉnh được (184). Không React, không mạng — để test được từng quy tắc.
 * Mô hình: "bản máy chủ" (cache vai trò) + "bản nháp" (các ô vừa bấm, chưa gửi). Ô hiển thị = bản nháp thắng bản máy chủ.
 */

/** Ô đã bấm nhưng chưa lưu: `true` = bật, `false` = tắt. Chỉ giữ ô KHÁC bản máy chủ (bấm hai lần = bỏ mục). */
export type Desired = Readonly<Record<string, boolean>>;

/** Hai bộ quyền bằng nhau như tập hợp (bỏ qua thứ tự). */
export const sameKeySet = (a: readonly string[], b: readonly string[]): boolean =>
  sameRoleSet(a, b);

/** Ô `key` đang BẬT? Bản nháp (nếu có mục cho ô này) thắng bản máy chủ. */
export function hasKey(
  base: readonly string[],
  desired: Desired | undefined,
  key: string,
): boolean {
  return desired && key in desired ? desired[key] === true : base.includes(key);
}

/** Bộ quyền hiệu lực = bản gốc + bản nháp: giữ thứ tự gốc, bỏ ô tắt, thêm ô bật ở cuối. Không sửa đầu vào. */
export function applyDesired(base: readonly string[], desired: Desired | undefined): string[] {
  if (!desired) return [...base];
  const kept = base.filter((k) => desired[k] !== false);
  const added = Object.keys(desired).filter((k) => desired[k] === true && !base.includes(k));
  return [...kept, ...added];
}

function withEntry(base: readonly string[], desired: Desired, key: string, on: boolean): Desired {
  const next = { ...desired };
  // Khớp bản máy chủ = không còn gì để gửi cho ô này.
  if (on === base.includes(key)) delete next[key];
  else next[key] = on;
  return next;
}

/** Đảo MỘT ô. */
export function toggleDesired(base: readonly string[], desired: Desired, key: string): Desired {
  return withEntry(base, desired, key, !hasKey(base, desired, key));
}

/** Đặt cả một nhóm ô về `on`. */
export function setManyDesired(
  base: readonly string[],
  desired: Desired,
  keys: readonly string[],
  on: boolean,
): Desired {
  return keys.reduce<Desired>((d, k) => withEntry(base, d, k, on), desired);
}

/**
 * Bản nháp sau khi `sent` đã được gửi đi: bỏ các ô trùng chiều với phần đã gửi, giữ ô bấm thêm (hoặc bấm ngược lại) trong lúc
 * lệnh lưu bắt đầu chạy.
 */
export function subtractDesired(current: Desired, sent: Desired): Desired {
  const left: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(current)) if (sent[k] !== v) left[k] = v;
  return left;
}

export type GroupStateName = 'full' | 'partial' | 'none';
export interface GroupState {
  state: GroupStateName;
  count: number;
  total: number;
}

/** Trạng thái ô NHÓM: đủ / một phần / không (cùng số đếm để vẽ chữ "3/5" — không chỉ dựa vào màu). */
export function groupState(keys: readonly string[], has: (key: string) => boolean): GroupState {
  const count = keys.filter(has).length;
  const total = keys.length;
  const state: GroupStateName = count === 0 ? 'none' : count === total ? 'full' : 'partial';
  return { state, count, total };
}

/** Bấm ô nhóm: đủ → tắt cả nhóm; một phần hoặc không → bật cả nhóm. */
export const groupTargetOn = (state: GroupStateName): boolean => state !== 'full';

/**
 * Kế hoạch gửi sau khi hết nhịp gom bấm: bản cuối = bản MÁY CHỦ MỚI NHẤT (`latest`, có thể đã đổi trong lúc chờ) + các ô
 * đã bấm. `changed=false` (bấm hai lần về như cũ) → không gửi PATCH thừa.
 */
export function planFlush(
  latest: readonly string[],
  desired: Desired,
): { next: string[]; changed: boolean } {
  const next = applyDesired(latest, desired);
  return { next, changed: !sameKeySet(latest, next) };
}

/** Kế hoạch Hoàn tác: khôi phục bộ `before`; `null` khi không khác. Bộ rỗng hợp lệ (máy chủ cho vai trò không quyền). */
export function planPermUndo(
  before: readonly string[],
  after: readonly string[],
): { keys: string[] } | null {
  return sameKeySet(before, after) ? null : { keys: [...before] };
}

/* ------------------------------ chốt quyền thiết yếu ------------------------------ */

const ADMIN: PermissionKey = 'workspace:admin';
const MANAGE: PermissionKey = 'member:manage';

const LAST_ADMIN_BLOCK_REASON =
  'Không thể gỡ quyền quản trị cuối cùng — không gian làm việc sẽ không còn quản trị viên. Hãy cấp quyền quản trị cho vai trò khác trước.';

export interface GuardCtx {
  /** Vai trò đang sửa (bộ quyền của nó lấy từ `before`/`after`, không từ `roles`). */
  role: { id: string };
  /** Mọi vai trò (bản cache) — để tính quyền thành viên giữ qua các vai trò khác. */
  roles: readonly { id: string; permissionKeys: readonly string[] }[];
  /** Thành viên không gian (kèm vai trò). `undefined` = chưa tải: chốt không tính được, lớp gọi phải khoá sửa. */
  members: readonly MemberDto[] | undefined;
  selfId: string | null;
  selfIsSystemAdmin: boolean;
}

export type GuardResult =
  | { kind: 'ok' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'confirm'; reason: 'admin' | 'manage' };

/** Thành viên `m` có quyền `perm` khi vai trò đang sửa mang bộ `roleKeys`? */
function holds(ctx: GuardCtx, m: MemberDto, roleKeys: readonly string[], perm: string): boolean {
  return m.roles.some((r) => {
    const keys =
      r.id === ctx.role.id
        ? roleKeys
        : (ctx.roles.find((x) => x.id === r.id)?.permissionKeys ?? []);
    return keys.includes(perm);
  });
}

/** Mình (người đang sửa) mất quyền thiết yếu nào khi vai trò đổi `before` → `after`? Admin hệ thống không bao giờ mất. */
export function selfLoss(
  ctx: GuardCtx,
  before: readonly string[],
  after: readonly string[],
): 'admin' | 'manage' | null {
  if (ctx.selfIsSystemAdmin || !ctx.members || !ctx.selfId) return null;
  const me = ctx.members.find((m) => m.user.id === ctx.selfId);
  if (!me) return null;
  const lost = (perm: string) => holds(ctx, me, before, perm) && !holds(ctx, me, after, perm);
  if (lost(ADMIN)) return 'admin';
  if (lost(MANAGE)) return 'manage';
  return null;
}

/**
 * Chốt cho MỘT lần đổi bộ quyền của vai trò tuỳ chỉnh (`before` → `after`, đều là bộ HIỆU LỤC trên màn hình):
 * - Phản chiếu máy chủ (`MembersService.assertNotLastWorkspaceAdmin`, nay cũng ở `RolesService.update`): gỡ `workspace:admin`
 *   khiến không còn thành viên HOẠT ĐỘNG nào giữ quyền đó → chặn. Máy chủ vẫn là nơi quyết định cuối cùng (409).
 * - TỰ mất `workspace:admin`/`member:manage` của chính mình → hỏi xác nhận (máy chủ cho phép; chỉ là khó lấy lại).
 * Máy chủ KHÔNG chặn gỡ `member:manage` cuối cùng (Workspace Admin luôn có), nên chốt này cũng không.
 */
export function guardRoleEdit(
  ctx: GuardCtx,
  before: readonly string[],
  after: readonly string[],
): GuardResult {
  if (!ctx.members) return { kind: 'ok' };
  const lostAdmin = before.includes(ADMIN) && !after.includes(ADMIN);
  const lostManage = before.includes(MANAGE) && !after.includes(MANAGE);
  if (!lostAdmin && !lostManage) return { kind: 'ok' };
  if (lostAdmin) {
    const active = ctx.members.filter((m) => m.user.status !== 'DEACTIVATED');
    const hadAdmin = active.some((m) => holds(ctx, m, before, ADMIN));
    const hasAdmin = active.some((m) => holds(ctx, m, after, ADMIN));
    if (hadAdmin && !hasAdmin) return { kind: 'blocked', reason: LAST_ADMIN_BLOCK_REASON };
  }
  const loss = selfLoss(ctx, before, after);
  return loss ? { kind: 'confirm', reason: loss } : { kind: 'ok' };
}

/** Tên đề xuất khi nhân bản — "Tên (bản sao)", cắt phần tên gốc để không vượt giới hạn 60 ký tự của máy chủ. */
const CLONE_SUFFIX = ' (bản sao)';
export function cloneName(sourceName: string): string {
  return `${roleLabel(sourceName).slice(0, 60 - CLONE_SUFFIX.length)}${CLONE_SUFFIX}`;
}
