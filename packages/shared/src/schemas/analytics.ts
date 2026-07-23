/** DTO báo cáo/analytics (dùng chung BE compute & FE render recharts). */

export interface BurndownPoint {
  date: string; // YYYY-MM-DD
  ideal: number;
  remaining: number;
}

export interface BurndownReport {
  sprintId: string;
  sprintName: string;
  committedPoints: number;
  start: string | null;
  end: string | null;
  series: BurndownPoint[];
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
