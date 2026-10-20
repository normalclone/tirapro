/**
 * Ngân sách thời gian theo người từ danh sách phân bổ — thuần (171). Máy chủ KHÔNG chặn tổng > 100%: nhiều phân bổ chồng nhau
 * trong cùng ngày được CỘNG DỒN (`resources.service` tính năng lực = Σ % của các phân bổ phủ ngày đó). Ở đây tính lại đúng
 * như vậy theo từng ngày làm việc (T2–T6) rồi lấy NGÀY ĐỈNH; phân bổ nối tiếp nhau không bị cộng nhầm.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Trần số ngày quét một khoảng (khoảng bị chặn 26 tuần ở máy chủ). */
const MAX_DAYS = 400;

/** Các ngày làm việc (T2–T6) trong [from, to], bao gồm hai đầu; đoạn rỗng/đảo/hỏng → []. */
export function workingDaysBetween(from: string, to: string): string[] {
  const a = toMs(from);
  const b = toMs(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out: string[] = [];
  for (let ms = a, n = 0; ms <= b && n < MAX_DAYS; ms += DAY_MS, n++) {
    const dow = new Date(ms).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(isoOf(ms));
  }
  return out;
}

/** Phần của một phân bổ mà ngân sách cần (`AllocationDto` thoả cấu trúc này). */
export interface BudgetAllocation {
  userId: string;
  projectId: string;
  percent: number;
  startDate: string;
  endDate: string;
  project: { id: string; key: string; name: string };
  user: { id: string; displayName: string };
}

interface BudgetProjectShare {
  projectId: string;
  key: string;
  name: string;
  percent: number;
}

export interface PersonBudget {
  userId: string;
  name: string;
  /** Ngày làm việc có tổng % cao nhất (hoà → ngày SỚM nhất). */
  peak: { percent: number; day: string };
  /** Số ngày làm việc trong khoảng có tổng > 100%. */
  overDays: number;
  /** Số ngày làm việc trong khoảng đang xem. */
  workingDays: number;
  /** Chia theo dự án TẠI ngày đỉnh (gộp các phân bổ cùng dự án), % giảm dần. */
  perProject: BudgetProjectShare[];
}

/**
 * Ngân sách của từng người trong [from, to]. Chỉ trả người có ít nhất một phân bổ phủ một ngày làm việc của khoảng;
 * sắp theo tên (tiếng Việt). Bản ghi ngày hỏng/đảo bị bỏ, không ảnh hưởng người khác.
 */
export function allocationBudgets(
  allocations: readonly BudgetAllocation[],
  from: string,
  to: string,
): PersonBudget[] {
  const days = workingDaysBetween(from, to);
  if (days.length === 0) return [];
  const byUser = new Map<string, BudgetAllocation[]>();
  for (const a of allocations) {
    if (Number.isNaN(toMs(a.startDate)) || Number.isNaN(toMs(a.endDate))) continue;
    if (toMs(a.endDate) < toMs(a.startDate)) continue;
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const out: PersonBudget[] = [];
  for (const [userId, list] of byUser) {
    let peak: { percent: number; day: string } | null = null;
    let overDays = 0;
    for (const day of days) {
      let total = 0;
      for (const a of list) if (a.startDate <= day && day <= a.endDate) total += a.percent;
      if (total === 0) continue;
      if (total > 100) overDays++;
      if (!peak || total > peak.percent) peak = { percent: total, day };
    }
    if (!peak) continue;
    const share = new Map<string, BudgetProjectShare>();
    for (const a of list) {
      if (!(a.startDate <= peak.day && peak.day <= a.endDate)) continue;
      const cur = share.get(a.projectId);
      if (cur) cur.percent += a.percent;
      else
        share.set(a.projectId, {
          projectId: a.projectId,
          key: a.project.key,
          name: a.project.name,
          percent: a.percent,
        });
    }
    out.push({
      userId,
      name: list[0]!.user.displayName,
      peak,
      overDays,
      workingDays: days.length,
      perProject: [...share.values()].sort((x, y) => y.percent - x.percent),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
