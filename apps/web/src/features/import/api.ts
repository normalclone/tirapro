import { useMutation, useQuery } from '@tanstack/react-query';
import type { JiraImportRunInput } from '@tirapro/shared';
import type {
  ImportJobDto,
  JiraAnalyzeResult,
  JiraDryRunResult,
  JiraImportTargets,
} from '@tirapro/types';
import { api } from '@/lib/api';

/** Khoá cache riêng của tính năng nhập dữ liệu (không dùng chung với module khác). */
export const importKeys = {
  targets: (projectId: string) => ['import', 'jira-targets', projectId] as const,
  job: (id: string) => ['import', 'job', id] as const,
};

/** Chu kỳ poll tiến độ job (ms). */
export const JOB_POLL_MS = 2000;

/** Bước 1: tải CSV Jira lên, nhận tóm tắt để dựng bảng mapping. */
export function useJiraAnalyze() {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await api.post<JiraAnalyzeResult>('/import/jira/analyze', fd)).data;
    },
  });
}

/** Bước 2: giá trị Tirapro để ghép; `projectId` rỗng = chưa chọn / project mới (không có trạng thái để chọn). */
export function useJiraTargets(projectId: string) {
  return useQuery({
    queryKey: importKeys.targets(projectId),
    queryFn: async () =>
      (
        await api.get<JiraImportTargets>('/import/jira/targets', {
          params: projectId ? { projectId } : undefined,
        })
      ).data,
  });
}

/** Bước 3: chạy thử hoặc chạy thật. Chạy thật trả `{ jobId }`, chạy thử trả số liệu. */
export function useJiraRun() {
  return useMutation({
    mutationFn: async (body: JiraImportRunInput) =>
      (await api.post<{ jobId: string } | JiraDryRunResult>('/import/jira/run', body)).data,
  });
}

/** Poll tiến độ mỗi 2 giây cho tới khi job kết thúc. */
export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: importKeys.job(jobId ?? ''),
    enabled: !!jobId,
    queryFn: async () => (await api.get<ImportJobDto>(`/import/jobs/${jobId}`)).data,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'PENDING' || status === 'RUNNING' || status === undefined
        ? JOB_POLL_MS
        : false;
    },
  });
}

/** Kết quả tổng kết do server ghi vào `ImportJob.result`. */
export interface JiraImportSummary {
  projectKey?: string;
  created?: number;
  failed?: number;
  warnings?: number;
  epics?: number;
  subtasks?: number;
  sprints?: number;
  labels?: number;
  comments?: number;
}
