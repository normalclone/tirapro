import type { IssueDto } from '@tirapro/types';
import { epicIdOf } from '@/lib/epic';
import { isEpicIssue } from '@/lib/issueRefs';

/** Loại (từ meta dự án) có phải Epic không — cùng định nghĩa máy chủ: `key = EPIC` hoặc cấp phân cấp ≥ 1. */
export const isEpicTypeOption = (t: { key: string | null; hierarchyLevel?: number }): boolean =>
  t.key === 'EPIC' || (t.hierarchyLevel ?? 0) >= 1;

type Ref = Pick<IssueDto, 'key' | 'summary'>;

/** Những gì mất đi / đổi chỗ khi một việc thường đổi thành Epic ("Epic không được là con của Epic"). */
export interface EpicConversionPlan {
  /** Epic đang chứa việc (`epicId` hoặc cha trực tiếp là Epic); `undefined` = có Epic nhưng không có trong danh sách nạp. */
  epic: Ref | null | undefined;
  /** Việc cha thường (không phải Epic); `undefined` = có cha nhưng không có trong danh sách nạp. */
  parent: Ref | null | undefined;
  /** Số việc con trực tiếp sẽ chuyển thành việc của Epic mới. */
  childCount: number;
  /** Còn gì để gỡ khỏi Epic/việc cha (quyết định có gửi `epicId/parentId = null` và có cho Hoàn tác không). */
  detaches: boolean;
}

/**
 * Kế hoạch khi đổi `issue` sang loại Epic: `null` = không cần hỏi (đã là Epic, hoặc không thuộc Epic/việc cha và không có việc con).
 * Epic đang chứa việc tra từ `epicId` rồi tới cha-là-Epic (dữ liệu cũ); việc cha thường là `parentId` còn lại.
 */
export function epicConversionPlan(issue: IssueDto, issues: IssueDto[]): EpicConversionPlan | null {
  if (isEpicIssue(issue)) return null;
  const byId = new Map(issues.map((i) => [i.id, i]));
  const epicId = epicIdOf(issue, byId);
  const parent = issue.parentId ? byId.get(issue.parentId) : undefined;
  const parentIsEpic = !!parent && isEpicIssue(parent);
  const hasParent = !!issue.parentId && !parentIsEpic;
  const childCount = issues.filter((i) => i.parentId === issue.id).length;
  const detaches = !!issue.epicId || !!issue.parentId;
  if (!detaches && childCount === 0) return null;
  return {
    epic: epicId ? (byId.get(epicId) ?? undefined) : null,
    parent: hasParent ? (parent ?? undefined) : null,
    childCount,
    detaches,
  };
}

const label = (r: Ref | undefined) => (r ? `${r.key} ${r.summary}` : 'một việc khác');

/** Lời xác nhận: nói rõ việc sẽ rời Epic/việc cha nào và các việc con sẽ đi đâu. */
export function epicConversionCopy(
  issueKey: string,
  plan: EpicConversionPlan,
): { title: string; description: string } {
  const parts: string[] = [];
  if (plan.epic !== null)
    parts.push(
      `Việc này đang thuộc Epic ${plan.epic ? label(plan.epic) : 'khác'} — đổi thành Epic sẽ gỡ nó khỏi Epic đó.`,
    );
  if (plan.parent !== null)
    parts.push(
      `Việc này đang là việc con của ${label(plan.parent)} — đổi thành Epic sẽ gỡ nó khỏi việc cha đó.`,
    );
  if (plan.childCount > 0)
    parts.push(
      `${plan.childCount} việc con trực tiếp sẽ chuyển thành việc thuộc Epic này (việc cháu giữ nguyên).`,
    );
  if (plan.detaches && plan.childCount === 0) parts.push('Có thể hoàn tác ngay sau đó.');
  return { title: `Đổi ${issueKey} thành Epic?`, description: parts.join(' ') };
}
