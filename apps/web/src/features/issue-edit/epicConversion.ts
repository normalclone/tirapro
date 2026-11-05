import axios from 'axios';
import type { IssueDto } from '@tirapro/types';
import { epicIdOf } from '@/lib/epic';
import { isEpicIssue } from '@/lib/issueRefs';

/** Loại (từ meta dự án) có phải Epic không — cùng định nghĩa máy chủ: `key = EPIC` hoặc cấp phân cấp ≥ 1. */
export const isEpicTypeOption = (t: { key: string | null; hierarchyLevel?: number }): boolean =>
  t.key === 'EPIC' || (t.hierarchyLevel ?? 0) >= 1;

type Ref = Pick<IssueDto, 'key' | 'summary'>;

/** Việc thường đang thuộc Epic/việc cha: đổi sang Epic phải gỡ chúng ("Epic không được là con của Epic"). */
export interface EpicConversionPlan {
  /** Epic đang chứa việc (`epicId` hoặc cha trực tiếp là Epic); `undefined` = có Epic nhưng không có trong danh sách nạp. */
  epic: Ref | null | undefined;
  /** Việc cha thường (không phải Epic); `undefined` = có cha nhưng không có trong danh sách nạp. */
  parent: Ref | null | undefined;
}

/**
 * Kế hoạch gỡ khi đổi `issue` sang loại Epic: `null` = không có gì để gỡ (đã là Epic, hoặc không thuộc Epic/việc cha). Dựa vào
 * `epicId/parentId` của CHÍNH việc (luôn đủ); danh sách dự án chỉ để lấy tên hiển thị. Việc CON không đếm ở đây: số việc con do
 * máy chủ báo (422 `EPIC_ADOPT_CHILDREN_REQUIRED`), không suy từ danh sách nạp (có thể chưa đủ).
 */
export function epicConversionPlan(issue: IssueDto, issues: IssueDto[]): EpicConversionPlan | null {
  if (isEpicIssue(issue) || (!issue.epicId && !issue.parentId)) return null;
  const byId = new Map(issues.map((i) => [i.id, i]));
  const epicId = epicIdOf(issue, byId);
  const parent = issue.parentId ? byId.get(issue.parentId) : undefined;
  const hasParent = !!issue.parentId && !(parent && isEpicIssue(parent));
  return {
    epic: epicId ? (byId.get(epicId) ?? undefined) : null,
    parent: hasParent ? (parent ?? undefined) : null,
  };
}

const label = (r: Ref | undefined) => (r ? `${r.key} ${r.summary}` : 'một việc khác');

/** Lời xác nhận gỡ: nói rõ việc sẽ rời Epic/việc cha nào. */
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
  parts.push('Có thể hoàn tác ngay sau đó.');
  return { title: `Đổi ${issueKey} thành Epic?`, description: parts.join(' ') };
}

/** Số sub-task (việc con kiểu sub-task) CÒN trong danh sách nạp của việc — đủ để vô hiệu hoá lựa chọn Epic sớm; máy chủ vẫn chặn. */
export function cachedSubtaskCount(issue: Pick<IssueDto, 'id'>, issues: IssueDto[]): number {
  return issues.filter((i) => i.parentId === issue.id && i.type.isSubtask).length;
}

/**
 * Lý do không đổi được sang Epic vì còn việc con kiểu sub-task (cùng ý với máy chủ); `null` khi không chặn. `subtaskTypeName` là TÊN loại
 * lấy từ cấu hình dự án (không gõ cứng: "task" chỉ xuất hiện như tên loại, UX_CONVENTIONS §19).
 */
export function epicBlockedReason(subtasks: number, subtaskTypeName: string): string | null {
  return subtasks > 0
    ? `Việc này đang có ${subtasks} việc con (${subtaskTypeName}) — ${subtaskTypeName} phải nằm dưới một việc thường. Hãy chuyển hoặc xoá chúng trước khi đổi thành Epic`
    : null;
}

/** Bóc 422 `EPIC_ADOPT_CHILDREN_REQUIRED`: số việc con trực tiếp sẽ chuyển sang Epic mới; lỗi khác → `null`. */
export function adoptChildrenRequired(e: unknown): number | null {
  if (!axios.isAxiosError(e)) return null;
  const err = (
    e.response?.data as
      | { error?: { code?: string; details?: Array<{ field?: string; count?: number }> } }
      | undefined
  )?.error;
  if (err?.code !== 'EPIC_ADOPT_CHILDREN_REQUIRED') return null;
  return err.details?.find((d) => d.field === 'adoptChildren')?.count ?? 0;
}

/** Hộp xác nhận chuyển việc con (số lượng do máy chủ báo). */
export function adoptChildrenCopy(
  issueKey: string,
  count: number,
): { title: string; description: string } {
  return {
    title: `Chuyển ${count} việc con sang Epic ${issueKey}?`,
    description: `${count} việc con trực tiếp của ${issueKey} sẽ chuyển thành việc thuộc Epic này (việc cháu giữ nguyên). Không hoàn tác tự động được.`,
  };
}
