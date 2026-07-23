import { useQuery } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

const MY_ISSUES_JQL = 'assignee = currentUser() ORDER BY updated DESC';

/** "Việc của tôi" — các issue được giao cho người dùng hiện tại, mới cập nhật trước. */
export function useMyIssues() {
  return useQuery({
    queryKey: ['my-issues'],
    queryFn: async () => {
      const url = `/search?jql=${encodeURIComponent(MY_ISSUES_JQL)}&limit=15`;
      return (await api.get<ListResponse<IssueDto>>(url)).data.data;
    },
    staleTime: 15_000,
  });
}

/** Số liệu tổng hợp một dự án (hoặc toàn workspace) cho Tổng quan admin. */
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
 * Tổng quan toàn workspace (mọi dự án) cho admin — `GET /reports/overview`.
 * Chỉ gọi khi người dùng là admin (`enabled`) để tránh 403 với người dùng thường.
 */
export function useWorkspaceOverview(enabled: boolean) {
  return useQuery({
    queryKey: ['workspace-overview'],
    queryFn: async () => (await api.get<WorkspaceOverview>('/reports/overview')).data,
    enabled,
    staleTime: 30_000,
  });
}
