import type { IssueDto, ProjectSubTeamDto } from '@tirapro/types';

/** Làn của việc không thuộc team nào (gồm việc chưa gán) — cùng khoá với `NO_LANE` của các kiểu chia hàng khác. */
export const NO_TEAM_LANE = '__none__';

export interface TeamLane {
  key: string;
  name: string;
  color: string | null;
  issues: IssueDto[];
  /** Làn "Chưa thuộc team nào". */
  empty?: boolean;
}

/**
 * Chia việc thành làn theo TEAM RIÊNG của dự án. Mỗi việc nằm ở ĐÚNG MỘT làn (kéo-thả của thẻ cần id duy nhất): làn của team đầu tiên
 * theo tên mà người phụ trách thuộc về — ưu tiên team đang được chọn ở bộ lọc team. Người ở nhiều team vì vậy chỉ hiện ở một làn;
 * muốn thấy họ ở làn khác thì lọc theo team đó. Việc chưa gán / người không thuộc team nào → làn "Chưa thuộc team nào" (luôn cuối).
 * Chỉ trả các làn có việc.
 */
export function buildTeamLanes(
  list: readonly IssueDto[],
  teams: readonly ProjectSubTeamDto[],
  selected: readonly string[] = [],
): TeamLane[] {
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const preferred = sorted.filter((t) => selected.includes(t.id));
  const order = [...preferred, ...sorted.filter((t) => !preferred.includes(t))];
  const memberSets = new Map(order.map((t) => [t.id, new Set(t.members.map((m) => m.id))]));
  const lanes = new Map<string, TeamLane>();
  const rest: TeamLane = {
    key: NO_TEAM_LANE,
    name: 'Chưa thuộc team nào',
    color: null,
    issues: [],
    empty: true,
  };
  for (const i of list) {
    const team = i.assigneeId
      ? order.find((t) => memberSets.get(t.id)!.has(i.assigneeId!))
      : undefined;
    if (!team) {
      rest.issues.push(i);
      continue;
    }
    let lane = lanes.get(team.id);
    if (!lane) {
      lane = { key: team.id, name: team.name, color: team.color, issues: [] };
      lanes.set(team.id, lane);
    }
    lane.issues.push(i);
  }
  const named = sorted.flatMap((t) => (lanes.has(t.id) ? [lanes.get(t.id)!] : []));
  return rest.issues.length > 0 ? [...named, rest] : named;
}

/** Sở thích bảng lưu theo dự án (`tirapro:boardPrefs:<projectId>`): người phụ trách + các team đang lọc. */
export interface BoardPrefs {
  assignee: string;
  teams: string[];
}

export function parseBoardPrefs(raw: string | null): BoardPrefs {
  try {
    const p = JSON.parse(raw || '{}') as { assignee?: unknown; teams?: unknown };
    return {
      assignee: typeof p.assignee === 'string' ? p.assignee : '',
      teams: Array.isArray(p.teams)
        ? p.teams.filter((t): t is string => typeof t === 'string')
        : [],
    };
  } catch {
    return { assignee: '', teams: [] };
  }
}
