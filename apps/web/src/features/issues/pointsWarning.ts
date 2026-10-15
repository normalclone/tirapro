import type { IssueDto, SprintDto } from '@tirapro/types';

type Sp = Pick<SprintDto, 'id' | 'name' | 'state'>;
type Is = Pick<IssueDto, 'key' | 'sprintId' | 'status'>;

export const WARN_TITLE = 'Sửa điểm của việc đã hoàn thành?';

function reasons(i: Is, sprints: Sp[] | undefined): string[] {
  const out: string[] = [];
  if (i.status.category === 'DONE') out.push(`${i.key} đã hoàn thành`);
  const sp = i.sprintId ? sprints?.find((s) => s.id === i.sprintId) : undefined;
  if (sp?.state === 'CLOSED') out.push(`${i.key} nằm trong sprint đã kết thúc “${sp.name}”`);
  return out;
}

/** Nội dung cảnh báo khi đổi điểm một việc; `null` = không cần hỏi. */
export function pointsEditWarning(i: Is, sprints: Sp[] | undefined): string | null {
  const r = reasons(i, sprints);
  return r.length
    ? `${r.join(' và ')}. Đổi điểm bây giờ sẽ làm lệch velocity và báo cáo của sprint đó.`
    : null;
}

/** Một hộp duy nhất cho cả lô. */
export function pointsEditWarningBulk(list: Is[], sprints: Sp[] | undefined): string | null {
  const n = list.filter((i) => reasons(i, sprints).length > 0).length;
  return n
    ? `${n} việc trong số đã chọn đã hoàn thành hoặc thuộc sprint đã kết thúc. Đổi điểm sẽ làm lệch velocity và báo cáo của các sprint đó.`
    : null;
}
