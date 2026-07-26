import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** Các trường mặc định của issue lưu trong `payload` của mẫu / việc lặp lại. */
export interface IssuePayload {
  typeId?: string | null;
  priorityId?: string | null;
  summary?: string | null;
  description?: string | null;
  assigneeId?: string | null;
  labelIds?: string[];
  storyPoints?: number | null;
}

interface ProjectBrief {
  id: string;
  key: string;
  name: string;
}

export interface IssueTemplate {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: ProjectBrief | null;
  name: string;
  description: string | null;
  payload: IssuePayload;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringIssue {
  id: string;
  projectId: string;
  project: ProjectBrief;
  name: string;
  freq: RecurrenceFreq;
  interval: number;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
  payload: IssuePayload;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const templatesKey = ['automation', 'templates'] as const;
export const recurringKey = ['automation', 'recurring'] as const;

/**
 * Guard quyền của API đọc `projectId` từ params/body/query. Gửi kèm dự án của bản ghi để
 * quản trị DỰ ÁN (không phải quản trị workspace) cũng thao tác được; máy chủ vẫn kiểm tra
 * lại theo dự án thật của bản ghi.
 */
const scopeParams = (projectId?: string | null) => (projectId ? { projectId } : undefined);

/* ------------------------------ Mẫu issue ------------------------------ */

export function useIssueTemplates() {
  return useQuery({
    queryKey: templatesKey,
    queryFn: async () => (await api.get<IssueTemplate[]>('/automation/templates')).data,
  });
}

export interface TemplateInput {
  name?: string;
  description?: string | null;
  projectId?: string | null;
  payload?: IssuePayload;
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) =>
      api.post<IssueTemplate>('/automation/templates', input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templatesKey }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: TemplateInput & { id: string }) =>
      api.put<IssueTemplate>(`/automation/templates/${id}`, input, { params: scopeParams(input.projectId) }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templatesKey }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId?: string | null }) =>
      api.delete(`/automation/templates/${id}`, { params: scopeParams(projectId) }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: templatesKey }),
  });
}

/* ---------------------------- Việc lặp lại ----------------------------- */

export function useRecurringIssues() {
  return useQuery({
    queryKey: recurringKey,
    queryFn: async () => (await api.get<RecurringIssue[]>('/automation/recurring')).data,
  });
}

export interface RecurringInput {
  projectId?: string;
  name?: string;
  freq?: RecurrenceFreq;
  interval?: number;
  weekday?: number | null;
  monthDay?: number | null;
  hour?: number;
  active?: boolean;
  payload?: IssuePayload;
}

export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecurringInput) =>
      api.post<RecurringIssue>('/automation/recurring', input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: recurringKey }),
  });
}

export function useUpdateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId, ...input }: RecurringInput & { id: string }) =>
      api.put<RecurringIssue>(`/automation/recurring/${id}`, input, { params: scopeParams(projectId) }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: recurringKey }),
  });
}

export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api.delete(`/automation/recurring/${id}`, { params: scopeParams(projectId) }).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: recurringKey }),
  });
}

/** Tạo issue ngay từ việc lặp lại (không dời lịch chạy kế tiếp). */
export function useRunRecurringNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      api
        .post<{ success: boolean; issue: { id: string; key: string } }>(
          `/automation/recurring/${id}/run-now`, undefined, { params: scopeParams(projectId) },
        )
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recurringKey });
      void qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}

/* ------------------------------- Nhãn hiển thị -------------------------- */

export const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'] as const;

export const FREQ_LABELS: Record<RecurrenceFreq, string> = {
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần',
  MONTHLY: 'Hằng tháng',
};

/** Mô tả lịch bằng tiếng Việt: "Mỗi tuần vào Thứ 2 lúc 8:00". */
export function describeRecurrence(r: Pick<RecurringIssue, 'freq' | 'interval' | 'weekday' | 'monthDay' | 'hour'>): string {
  const at = `lúc ${r.hour}:00`;
  const n = Math.max(1, r.interval || 1);
  if (r.freq === 'DAILY') return n === 1 ? `Mỗi ngày ${at}` : `Mỗi ${n} ngày ${at}`;
  if (r.freq === 'WEEKLY') {
    const day = WEEKDAY_LABELS[r.weekday ?? 1] ?? WEEKDAY_LABELS[1];
    return `${n === 1 ? 'Mỗi tuần' : `Mỗi ${n} tuần`} vào ${day} ${at}`;
  }
  return `${n === 1 ? 'Mỗi tháng' : `Mỗi ${n} tháng`} vào ngày ${r.monthDay ?? 1} ${at}`;
}
