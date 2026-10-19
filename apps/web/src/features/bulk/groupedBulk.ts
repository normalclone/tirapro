import type { IssueDto } from '@tirapro/types';
import type { BulkIssuePatch } from '@/features/backlog/api';
import {
  allowedWhenArchived,
  canEditIssue,
  hasPermission,
  type PermissionContext,
} from '@/lib/permissions';
import type { UndoPlan, VersionedItem } from './bulkEdit';

/**
 * Hàng loạt trên danh sách TRẢI NHIỀU DỰ ÁN (kết quả Bộ lọc). API bulk chỉ nhận MỘT `projectId` mỗi lần, và quyền, quy trình,
 * nhãn, người chọn được đều theo dự án — nên lựa chọn được nhóm theo dự án, mỗi nhóm một lần gọi, kết quả gom lại.
 * Mọi quyết định ở đây là hàm thuần (có test); hook `useGroupedBulkEdit` chỉ nối với mạng/toast.
 */

export interface ProjectGroup {
  projectId: string;
  issues: IssueDto[];
}

/** Các việc ĐANG CHỌN (theo thứ tự `issues`) nhóm theo dự án; nhóm xếp theo lần xuất hiện đầu tiên. */
export function groupByProject(
  issues: readonly IssueDto[],
  selected: ReadonlySet<string>,
): ProjectGroup[] {
  const byProject = new Map<string, IssueDto[]>();
  for (const i of issues) {
    if (!selected.has(i.id)) continue;
    const list = byProject.get(i.projectId);
    if (list) list.push(i);
    else byProject.set(i.projectId, [i]);
  }
  return [...byProject].map(([projectId, list]) => ({ projectId, issues: list }));
}

/** Quyền của người dùng trên MỘT nhóm (một dự án). */
export interface GroupPerms {
  canAssign: boolean;
  /** Sửa được MỌI việc đang chọn của nhóm (`issue:edit`, hoặc `issue:edit:own` với việc của mình). */
  canEdit: boolean;
  canTransition: boolean;
}

/** Quyền trên một nhóm từ ngữ cảnh quyền của dự án đó. Dự án lưu trữ → chỉ đọc (`allowedWhenArchived`), kể cả quản trị. */
export function groupPermsFor(a: {
  ctx: PermissionContext;
  archived: boolean;
  issues: readonly IssueDto[];
  userId: string | null | undefined;
}): GroupPerms {
  const can = (perm: string) =>
    hasPermission(a.ctx, perm) && (!a.archived || allowedWhenArchived(perm));
  return {
    canAssign: can('issue:assign'),
    canEdit: !a.archived && a.issues.every((i) => canEditIssue(a.ctx, i, a.userId)),
    canTransition: can('issue:transition'),
  };
}

export type BulkActionId = 'assignMe' | 'assign' | 'priority' | 'points' | 'label' | 'status';

export interface ActionAvailability {
  visible: boolean;
  /** Dự án có quyền — hành động chạy trên các nhóm này. */
  applyProjectIds: string[];
  applyCount: number;
  totalCount: number;
  /** Việc ở dự án không có quyền: bị bỏ qua (báo trước khi chạy). */
  skipCount: number;
}

/**
 * Quy tắc theo mô hình dữ liệu/API:
 * - XUYÊN DỰ ÁN được: Gán cho tôi (người dùng hiện tại), Ưu tiên (Priority thuộc workspace), Điểm (một con số).
 * - CHỈ khi đúng MỘT dự án: Đổi người phụ trách (danh sách người chọn được theo dự án), Nhãn (nhãn theo dự án),
 *   Trạng thái (quy trình theo dự án). Sprint/Epic không có ở Bộ lọc.
 * Quyền theo dự án: gán = `issue:assign`; ưu tiên/điểm/nhãn = sửa được mọi việc của nhóm; trạng thái = `issue:transition`.
 * Có quyền ở ít nhất một nhóm → hiện và chạy trên nhóm có quyền (nhóm còn lại bỏ qua, đếm trong `skipCount`).
 */
const ACTION_RULES: Record<BulkActionId, { crossProject: boolean; perm: keyof GroupPerms }> = {
  assignMe: { crossProject: true, perm: 'canAssign' },
  assign: { crossProject: false, perm: 'canAssign' },
  priority: { crossProject: true, perm: 'canEdit' },
  points: { crossProject: true, perm: 'canEdit' },
  label: { crossProject: false, perm: 'canEdit' },
  status: { crossProject: false, perm: 'canTransition' },
};

export function availableBulkActions(
  groups: ReadonlyArray<{ projectId: string; count: number; perms: GroupPerms }>,
): Record<BulkActionId, ActionAvailability> {
  const total = groups.reduce((n, g) => n + g.count, 0);
  const out = {} as Record<BulkActionId, ActionAvailability>;
  for (const id of Object.keys(ACTION_RULES) as BulkActionId[]) {
    const rule = ACTION_RULES[id];
    const scoped = rule.crossProject || groups.length === 1;
    const allowed = scoped ? groups.filter((g) => g.perms[rule.perm]) : [];
    const applyCount = allowed.reduce((n, g) => n + g.count, 0);
    out[id] = {
      visible: allowed.length > 0,
      applyProjectIds: allowed.map((g) => g.projectId),
      applyCount,
      totalCount: total,
      skipCount: scoped ? total - applyCount : 0,
    };
  }
  return out;
}

/** Câu báo TRƯỚC khi chạy khi có việc bị bỏ qua vì thiếu quyền; `null` khi áp hết. */
export function applyNotice(a: ActionAvailability): string | null {
  if (a.skipCount <= 0 || a.applyCount <= 0) return null;
  return `Áp cho ${a.applyCount}/${a.totalCount} việc (${a.skipCount} việc không áp được: thiếu quyền, dự án đã lưu trữ hoặc việc của người khác)`;
}

/** `map` bất đồng bộ với số lượng chạy song song tối đa `limit`; giữ thứ tự kết quả theo `items`. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Kết quả của MỘT nhóm: đã gọi được (có thể một phần) hoặc lỗi hẳn ở lô đầu (chưa ghi gì). */
export type GroupOutcome =
  | {
      projectId: string;
      ok: true;
      updated: IssueDto[];
      /** Việc bị người khác sửa trước (409): version đã cũ, cần tải lại bản mới trước khi thử lại. */
      conflictIds: string[];
      /** Việc CHƯA được gửi vì một lô sau lỗi (mạng…) — version vẫn đúng, không phải "người khác sửa". */
      unsentIds: string[];
      /** Lỗi của lô thất bại đầu tiên (chỉ có khi `unsentIds` không rỗng). */
      error?: unknown;
    }
  | { projectId: string; ok: false; ids: string[]; error: unknown };

export interface GroupedAggregate {
  /** `all` = xong hết · `partial` = một phần · `none` = không việc nào xong. */
  kind: 'all' | 'partial' | 'none';
  updated: IssueDto[];
  /** Việc giữ chọn để thử lại: conflict + chưa gửi + mọi việc của nhóm lỗi hẳn. */
  retainIds: ReadonlySet<string>;
  /** Việc bị người khác sửa trước (ở nhóm gọi được) — cần tải lại bản mới để thử lại được. */
  editedConflictIds: string[];
  conflictCount: number;
  /** Việc chưa gửi vì lỗi giữa chừng (không phải conflict). */
  unsentCount: number;
  /** Lỗi đầu tiên của lô thất bại giữa chừng (nêu lý do thật thay vì đoán là "người khác sửa"). */
  firstError: unknown;
  projectsUpdated: number;
  failedProjects: Array<{ projectId: string; reason: string }>;
}

export function aggregateGroupResults(
  outcomes: readonly GroupOutcome[],
  reasonOf: (e: unknown) => string,
): GroupedAggregate {
  const updated: IssueDto[] = [];
  const retain = new Set<string>();
  const edited: string[] = [];
  const failedProjects: GroupedAggregate['failedProjects'] = [];
  let unsentCount = 0;
  let firstError: unknown;
  let projectsUpdated = 0;
  for (const o of outcomes) {
    if (!o.ok) {
      for (const id of o.ids) retain.add(id);
      failedProjects.push({ projectId: o.projectId, reason: reasonOf(o.error) });
      continue;
    }
    updated.push(...o.updated);
    if (o.updated.length > 0) projectsUpdated++;
    for (const id of o.conflictIds) {
      retain.add(id);
      edited.push(id);
    }
    for (const id of o.unsentIds) retain.add(id);
    unsentCount += o.unsentIds.length;
    firstError ??= o.error;
  }
  const clean = retain.size === 0 && failedProjects.length === 0;
  const kind = clean ? 'all' : updated.length === 0 ? 'none' : 'partial';
  return {
    kind,
    updated,
    retainIds: retain,
    editedConflictIds: edited,
    conflictCount: edited.length,
    unsentCount,
    firstError,
    projectsUpdated,
    failedProjects,
  };
}

/**
 * Dòng chính của toast tổng kết một lần bulk nhiều dự án. `keyOf` đổi projectId → mã dự án để đọc được; `skipped` = số việc
 * KHÔNG áp được (thiếu quyền, dự án lưu trữ, việc của người khác) — nêu "· N việc bỏ qua" để không im lặng.
 */
export function groupedBulkTitle(
  verb: string,
  a: GroupedAggregate,
  keyOf: (projectId: string) => string,
  skipped = 0,
): string {
  const n = a.updated.length;
  const inProjects = ` ở ${a.projectsUpdated} dự án`;
  const skip = skipped > 0 ? ` · ${skipped} việc bỏ qua` : '';
  if (a.kind === 'all')
    return `Đã ${verb} ${n} việc${a.projectsUpdated > 1 ? inProjects : ''}${skip}.`;
  const parts = [
    a.kind === 'partial' ? `Đã cập nhật ${n} việc${inProjects}` : 'Chưa cập nhật được việc nào',
  ];
  const unfinished = a.conflictCount + a.unsentCount;
  if (unfinished > 0) parts.push(`${unfinished} việc chưa cập nhật được`);
  if (a.failedProjects.length > 0) {
    const list = a.failedProjects.map((f) => `${keyOf(f.projectId)} — ${f.reason}`).join('; ');
    parts.push(`${a.failedProjects.length} dự án lỗi: ${list}`);
  }
  return parts.join(' · ') + skip;
}

/** Kết quả thử tải lại MỘT việc bị 409: `issue` = bản hiện tại, `null` = tải lỗi. */
export interface RefreshAttempt {
  id: string;
  issue: IssueDto | null;
}

/**
 * Kết quả Bộ lọc nằm trong state (không refetch) nên sau 409 dòng vẫn giữ version cũ và thử lại sẽ 409 mãi. Plan: các bản
 * tải lại được (ghi vào lớp phủ → dòng hiện thay đổi của người kia và mang version mới) + các id tải lỗi (giữ chọn, báo chạy lại truy vấn).
 */
export function planConflictRefresh(attempts: readonly RefreshAttempt[]): {
  fresh: IssueDto[];
  failedIds: string[];
} {
  const fresh: IssueDto[] = [];
  const failedIds: string[] = [];
  for (const a of attempts) {
    if (a.issue) fresh.push(a.issue);
    else failedIds.push(a.id);
  }
  return { fresh, failedIds };
}

/**
 * Mô tả phần "chưa xong" của một lần bulk nhiều dự án — trung thực về nguyên nhân: việc bị người khác sửa (đã tải lại bản
 * mới), việc không tải lại được (chạy lại truy vấn), việc chưa gửi vì lỗi giữa chừng (KHÔNG phải "người khác sửa").
 */
export function conflictHint(a: {
  refreshed: number;
  refreshFailed: number;
  unsent: number;
  rejection?: string | null;
}): string | undefined {
  const edited = a.refreshed + a.refreshFailed;
  if (edited === 0 && a.unsent === 0) return undefined;
  if (edited === 0) return a.rejection ?? 'Một số việc chưa gửi được — thử lại.';
  const parts: string[] = [];
  if (a.unsent > 0) parts.push(a.rejection ?? 'Một số việc chưa gửi được.');
  if (a.refreshed > 0)
    parts.push(
      `Người khác vừa sửa ${a.refreshed} việc — dòng đã cập nhật theo bản mới, kiểm tra rồi thử lại.`,
    );
  if (a.refreshFailed > 0)
    parts.push(
      `Không tải lại được ${a.refreshFailed} việc — hãy chạy lại truy vấn để lấy bản mới.`,
    );
  return parts.join(' ');
}

/** Một bước Hoàn tác thuộc một dự án (gọi bulk API của dự án đó). */
export type GroupedUndoPlan = Array<{
  projectId: string;
  items: VersionedItem[];
  patch: BulkIssuePatch;
}>;

/**
 * Hoàn tác theo nhóm: với mỗi dự án CÓ việc đã cập nhật, dựng kế hoạch bằng `build(việc đã chọn của nhóm, đã cập nhật)`
 * (giá trị cũ → patch ngược, version mới của máy chủ). `null` khi không việc nào xong hoặc một nhóm không đảo được.
 */
export function planGroupedUndo(
  groups: readonly ProjectGroup[],
  updatedByProject: ReadonlyMap<string, VersionedItem[]>,
  build: (targets: IssueDto[], updated: VersionedItem[]) => UndoPlan | null,
): GroupedUndoPlan | null {
  const plan: GroupedUndoPlan = [];
  for (const g of groups) {
    const updated = updatedByProject.get(g.projectId) ?? [];
    if (updated.length === 0) continue;
    const steps = build(g.issues, updated);
    if (!steps) return null;
    for (const s of steps) plan.push({ projectId: g.projectId, ...s });
  }
  return plan.length > 0 ? plan : null;
}
