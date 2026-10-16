import { skipToken, useQuery } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import type { ProjectHealthDto } from '@tirapro/shared';
import type { RaidLevel } from '@/features/raid/api';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

const MY_ISSUES_JQL = 'assignee = currentUser() ORDER BY updated DESC';

/** "Việc của tôi" — các issue được giao cho người dùng hiện tại, mới cập nhật trước. */
export function useMyIssues() {
  return useQuery({
    queryKey: keys.dashboard.myIssues,
    queryFn: async () => {
      const url = `/search?jql=${encodeURIComponent(MY_ISSUES_JQL)}&limit=15`;
      return (await api.get<ListResponse<IssueDto>>(url)).data.data;
    },
    staleTime: 15_000,
  });
}

/** Bug do tôi báo còn mở (loại chứa "bug" — chịu được workspace đổi tên loại), mới cập nhật trước. */
export const MY_BUGS_JQL =
  'reporter = currentUser() AND type ~ "bug" AND statusCategory != DONE ORDER BY updated DESC';

export function useMyReportedBugs() {
  return useQuery({
    queryKey: keys.dashboard.myBugs,
    queryFn: async () => {
      const url = `/search?jql=${encodeURIComponent(MY_BUGS_JQL)}&limit=30`;
      return (await api.get<ListResponse<IssueDto>>(url)).data.data;
    },
    staleTime: 15_000,
  });
}

/** Số liệu tổng hợp một dự án (hoặc toàn tổ chức) cho Tổng quan admin. */
export interface OverviewTotals {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  bug: number;
}

/** Sprint đang chạy của dự án (dùng trong bảng tổng quan). */
export interface OverviewSprint {
  name: string;
  /** Số ngày còn lại tới hạn sprint; <0 = đã trễ; null = sprint không đặt hạn. */
  daysLeft: number | null;
}

export interface OverviewProject extends OverviewTotals {
  id: string;
  key: string;
  name: string;
  sprint: OverviewSprint | null;
  health: ProjectHealthDto | null;
}

/** Một lát cắt cho sơ đồ (theo loại / theo ưu tiên). */
export interface OverviewSlice {
  name: string;
  color: string | null;
  count: number;
}

export interface OverviewTrendPoint {
  label: string;
  created: number;
  resolved: number;
}

export interface OverviewWarning {
  level: 'danger' | 'warning' | 'info';
  text: string;
}

export interface OverviewForecast {
  label: string;
  text: string;
}

export interface OverviewAttention {
  key: string;
  summary: string;
  projectKey: string;
  reason: string;
  level: 'danger' | 'warning';
}

export interface WorkspaceOverview {
  projectCount: number;
  totals: OverviewTotals;
  projects: OverviewProject[];
  byType: OverviewSlice[];
  byPriority: OverviewSlice[];
  trend: OverviewTrendPoint[];
  warnings: OverviewWarning[];
  forecast: OverviewForecast[];
  attention: OverviewAttention[];
}

/**
 * Tổng quan toàn tổ chức (mọi dự án) cho admin — `GET /reports/overview`.
 * Chỉ gọi khi người dùng là admin (`enabled`) để tránh 403 với người dùng thường.
 */
export function useWorkspaceOverview(enabled: boolean) {
  return useQuery({
    queryKey: keys.dashboard.workspaceOverview,
    queryFn: enabled
      ? async () => (await api.get<WorkspaceOverview>('/reports/overview')).data
      : skipToken,
    staleTime: 30_000,
  });
}

/** Ba thẻ lãnh đạo trên Tổng quan — `GET /reports/leadership` (mỗi mảng ≤5, đã lọc theo dự án người xem thấy). */
export interface LeadershipOverview {
  topRisks: Array<{
    id: string;
    title: string;
    score: number;
    level: RaidLevel;
    levelLabel: string;
    project: { key: string; name: string } | null;
    owner: { id: string; displayName: string } | null;
    dueDate: string | null;
  }>;
  slowGoals: Array<{
    id: string;
    name: string;
    period: string;
    progress: number;
    expectedProgress: number;
    owner: { id: string; displayName: string } | null;
  }>;
  overloaded: Array<{
    user: { id: string; displayName: string; avatarUrl: string | null };
    worstRatio: number;
    weekLabel: string;
    assignedHours: number;
    capacityHours: number;
  }>;
}

/** Thẻ lãnh đạo của Tổng quan admin; `enabled` = chỉ người có quyền xem báo cáo (tránh 403). */
export function useLeadership(enabled: boolean) {
  return useQuery({
    queryKey: keys.dashboard.leadership,
    queryFn: enabled
      ? async () => (await api.get<LeadershipOverview>('/reports/leadership')).data
      : skipToken,
    staleTime: 30_000,
  });
}
