import type { IssueDto } from '@tirapro/types';

/**
 * Điểm của Epic = tổng điểm việc cấp trên, điểm của việc CHA (có việc con chưa xoá) = tổng điểm việc con (máy chủ tính, xem
 * `PointsService`). Vì vậy MỌI phép CỘNG điểm ở client chỉ đếm VIỆC LÁ: bỏ Epic và bỏ việc đang là cha của một việc khác trong
 * tập đang nạp (không có trường `hasLiveChildren` — suy ra từ tập đã nạp, giống phía máy chủ `LEAF_POINTS_ONLY`).
 * Hiển thị điểm TỪNG việc không dùng các hàm này.
 */

/** Id các việc là cha của ít nhất một việc khác trong `issues`. */
export function parentIdSetOf(issues: readonly Pick<IssueDto, 'parentId'>[]): Set<string> {
  const s = new Set<string>();
  for (const i of issues) if (i.parentId) s.add(i.parentId);
  return s;
}

/** Việc này có việc con trong tập đã nạp không (Epic không tính: điểm Epic luôn là tổng). */
export const hasLoadedChildren = (
  issue: Pick<IssueDto, 'id'>,
  parentIds: ReadonlySet<string>,
): boolean => parentIds.has(issue.id);

/** Epic theo ĐÚNG luật phía máy chủ (`type.key = 'EPIC'`): loại tuỳ chỉnh cấp cao vẫn tính điểm theo công thức như Task. */
export const isPointsEpic = (issue: Pick<IssueDto, 'type'>): boolean => issue.type.key === 'EPIC';

/** Việc lá = không phải Epic và không là cha của việc nào trong tập — chỉ việc lá được cộng điểm. */
export function isPointsLeaf(
  issue: Pick<IssueDto, 'id' | 'type'>,
  parentIds: ReadonlySet<string>,
): boolean {
  return !isPointsEpic(issue) && !parentIds.has(issue.id);
}

/**
 * Tổng điểm các việc lá của `list`. `parentIds` mặc định suy từ chính `list`; khi `list` chỉ là một phần (khu sprint, kết
 * quả lọc) hãy truyền tập cha của TOÀN BỘ dữ liệu đã nạp để cha nằm ngoài `list` vẫn loại đúng.
 */
export function leafPointsSum(
  list: readonly IssueDto[],
  parentIds: ReadonlySet<string> = parentIdSetOf(list),
): number {
  let sum = 0;
  for (const i of list) if (isPointsLeaf(i, parentIds)) sum += i.storyPoints ?? 0;
  return sum;
}

/**
 * Đọc ô điểm CHỈNH TAY (Quản trị dự án): số nguyên 0–100, không được để trống (không có "xoá điểm": muốn bỏ chỉnh tay thì bấm
 * "Tính lại theo công thức"; web không bao giờ gửi `storyPoints: null`). Chấp nhận `3` hoặc `3,0`; số lẻ bị từ chối.
 */
export function parsePointsOverride(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const s = raw.trim().replace(',', '.');
  if (s === '') return { ok: false, error: 'Nhập số điểm (số nguyên từ 0 đến 100)' };
  if (!/^\d+(\.0+)?$/.test(s))
    return { ok: false, error: 'Điểm chỉnh tay phải là số nguyên từ 0 đến 100, ví dụ 5' };
  const n = Number(s);
  return n > 100 ? { ok: false, error: 'Điểm tối đa 100' } : { ok: true, value: n };
}

export const ROLLUP_POINTS_TIP = 'Tổng điểm việc con';
export const CHILD_SPRINT_TIP = 'Việc con đi theo sprint của việc cha';

/** Vai trò ô điểm của một dòng: `edit` = Quản trị dự án chỉnh tay được; `locked` = chỉ đọc (không đủ quyền); `rollup` = điểm tổng. */
export type PointsRole = 'edit' | 'locked' | 'rollup';

export function pointsRoleOf(
  issue: Pick<IssueDto, 'id' | 'type'>,
  parentIds: ReadonlySet<string>,
  canAdmin: boolean,
): PointsRole {
  if (!isPointsLeaf(issue, parentIds)) return 'rollup';
  return canAdmin ? 'edit' : 'locked';
}

export const EPIC_POINTS_TIP = 'Tổng điểm các việc trong Epic';

/** Điểm của việc này là TỔNG (Epic hoặc việc cha có việc con) → chỉ đọc, không có ô chỉnh tay. */
export const isRollupPoints = (issue: Pick<IssueDto, 'type'>, hasChildren: boolean): boolean =>
  isPointsEpic(issue) || hasChildren;

/**
 * Lời giải thích điểm khi rê chuột: Epic/việc cha → "Tổng điểm ..."; còn lại `pointsExplain` của máy chủ ("Bug · Khó · High =
 * 2×3×1.5 = 9", hoặc "Đã chỉnh tay (theo công thức: ...)").
 */
export function pointsTip(
  issue: Pick<IssueDto, 'pointsExplain' | 'type'>,
  hasChildren: boolean,
): string {
  if (isPointsEpic(issue)) return EPIC_POINTS_TIP;
  if (hasChildren) return `${ROLLUP_POINTS_TIP} — không chỉnh tay được`;
  return issue.pointsExplain || 'Điểm tự tính theo Loại × Độ khó × Ưu tiên';
}
