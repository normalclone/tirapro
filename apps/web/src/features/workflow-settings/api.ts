import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** ---- Workflow admin (workflows / statuses / transitions) ---- */

export type StatusCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';

export interface WorkflowStatus {
  id: string;
  name: string;
  category: StatusCategory;
  color: string | null;
  order: number;
  isInitial: boolean;
}

export interface WorkflowTransition {
  id: string;
  name: string;
  fromStatusId: string | null;
  toStatusId: string;
  order: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  isTemplate: boolean;
  isDefault: boolean;
  projectId: string | null;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
  /** Dự án đang dùng quy trình này làm quy trình mặc định (kể cả dự án đã xoá). GET /workflows luôn trả; để tuỳ chọn vì kiểu này còn được dùng làm dữ liệu giả ở nhiều nơi. */
  usedBy?: WorkflowUsedBy[];
  /** Số dự án người xem không xem được cũng đang dùng quy trình này — chỉ để hiện "+N dự án bạn không xem được" và giải thích vì sao không xoá được. */
  hiddenCount?: number;
}

interface WorkflowUsedBy {
  id: string;
  key: string;
  name: string;
  deleted: boolean;
}

export interface WorkflowCreateInput {
  name: string;
  description?: string;
  projectId?: string;
  isTemplate?: boolean;
}

export interface StatusCreateInput {
  name: string;
  category: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface StatusUpdateInput {
  name?: string;
  category?: StatusCategory;
  color?: string;
  order?: number;
  isInitial?: boolean;
}

export interface TransitionCreateInput {
  name: string;
  fromStatusId?: string | null;
  toStatusId: string;
  order?: number;
}

/* ---- Query ---- */

export function useWorkflows() {
  return useQuery({
    queryKey: keys.workflows,
    queryFn: async () => (await api.get<Workflow[]>('/workflows')).data,
  });
}

/* ---- Workflow mutations ---- */

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkflowCreateInput) =>
      api.post<Workflow>('/workflows', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/workflows/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

/* ---- Status mutations ---- */

export function useAddStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, input }: { workflowId: string; input: StatusCreateInput }) =>
      api.post<WorkflowStatus>(`/workflows/${workflowId}/statuses`, input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: StatusUpdateInput }) =>
      api.patch<WorkflowStatus>(`/statuses/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function useDeleteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/statuses/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

/* ---- Transition mutations ---- */

export function useAddTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, input }: { workflowId: string; input: TransitionCreateInput }) =>
      api
        .post<WorkflowTransition>(`/workflows/${workflowId}/transitions`, input)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function useDeleteTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/transitions/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}
