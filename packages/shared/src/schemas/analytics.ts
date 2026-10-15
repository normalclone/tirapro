/** DTO báo cáo/analytics (dùng chung BE compute & FE render recharts). */

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  ideal: number;
  /** null = ngày chưa tới (chỉ với sprint đang chạy) — không vẽ đường "Còn lại" sang tương lai. */
  remaining: number | null;
}

export interface BurndownReport {
  sprintId: string;
  sprintName: string;
  committedPoints: number;
  start: string | null;
  end: string | null;
  /** Hôm nay (YYYY-MM-DD, UTC) — FE dùng để vạch mốc "hôm nay" trên biểu đồ. */
  today: string;
  series: BurndownPoint[];
}

export interface SprintSummaryPoints {
  points: number;
  count: number;
}

export interface SprintSummaryReport {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    state: 'FUTURE' | 'ACTIVE' | 'CLOSED';
    startDate: string | null;
    endDate: string | null;
    completeDate: string | null;
    sequence: number;
  };
  /** ACTIVE/CLOSED: snapshot START (mốc cam kết) hoặc, thiếu, tổng hiện tại; FUTURE: tổng hiện tại. */
  committed: SprintSummaryPoints;
  /** CLOSED: snapshot CLOSE; ACTIVE/FUTURE: tính trực tiếp (status.category = DONE). */
  completed: SprintSummaryPoints;
  remaining: SprintSummaryPoints;
  /** Chỉ sprint CLOSED có payload (sprint đóng trước khi có tính năng → rỗng). */
  carriedOver: Array<{ id: string; key: string; summary: string; storyPoints: number | null }>;
  movedTo: { kind: 'backlog' | 'new' | 'sprint'; sprintId?: string; sprintName?: string } | null;
  /** Trung bình tối đa 3 sprint đã đóng TRƯỚC sprint này. */
  velocity: { average: number; sprintsCounted: number; deltaPct: number | null };
  time: { totalDays: number | null; elapsedDays: number | null; daysLeft: number | null };
}

/** Payload của SprintSnapshot(kind = CLOSE): việc chuyển tiếp khi đóng sprint + nơi chuyển tới. */
export interface SprintClosePayload {
  carriedOver: SprintSummaryReport['carriedOver'];
  movedTo: NonNullable<SprintSummaryReport['movedTo']>;
}

export interface VelocityEntry {
  sprintId: string;
  sprintName: string;
  committed: number;
  completed: number;
}

export interface VelocityReport {
  sprints: VelocityEntry[];
  averageCompleted: number;
}

export interface CfdPoint {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

export interface CfdReport {
  from: string;
  to: string;
  series: CfdPoint[];
}

export interface CreatedResolvedPoint {
  date: string;
  created: number;
  resolved: number;
}

export interface CreatedResolvedReport {
  from: string;
  to: string;
  series: CreatedResolvedPoint[];
}
