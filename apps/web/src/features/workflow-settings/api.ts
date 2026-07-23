import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** ---- Workflow admin (workflows / statuses / transitions) ---- */

export const workflowsKey = ['workflows'] as const;

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
}

export interface WorkflowCreateInput {
  name: string;
  description?: string;
  projectId?: string;
  isTemplate?: boolean;
}

export interface WorkflowUpdateInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
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
    queryKey: workflowsKey,
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
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WorkflowUpdateInput }) =>
      api.patch<Workflow>(`/workflows/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowsKey });
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
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: StatusUpdateInput }) =>
      api.patch<WorkflowStatus>(`/statuses/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}

export function useDeleteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/statuses/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowsKey });
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
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}

export function useDeleteTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/transitions/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowsKey });
    },
  });
}
