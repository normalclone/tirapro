import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

/** ---- Độ ưu tiên (priorities) ---- */

export interface Priority {
  id: string;
  name: string;
  color: string;
  iconKey?: string | null;
  rank: number;
  isDefault: boolean;
  isSystem: boolean;
}

export interface PriorityCreateInput {
  name: string;
  iconKey?: string;
  color?: string;
  rank?: number;
}

export interface PriorityUpdateInput {
  name?: string;
  color?: string;
  rank?: number;
  isDefault?: boolean;
}

export function usePriorities() {
  return useQuery({
    queryKey: keys.priorities,
    queryFn: async () => (await api.get<Priority[]>('/priorities')).data,
  });
}

export function useCreatePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PriorityCreateInput) =>
      api.post<Priority>('/priorities', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.priorities });
    },
  });
}

export function useUpdatePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PriorityUpdateInput }) =>
      api.patch<Priority>(`/priorities/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.priorities });
    },
  });
}

export function useDeletePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/priorities/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.priorities });
    },
  });
}

/** ---- Trường tuỳ chỉnh (custom field definitions) ---- */

export type CustomFieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'USER'
  | 'URL';

export interface CustomFieldOption {
  id: string;
  value: string;
}

export interface CustomField {
  id: string;
  name: string;
  type: CustomFieldType;
  isRequired: boolean;
  projectId: string | null;
  options?: CustomFieldOption[];
}

export interface CustomFieldCreateInput {
  name: string;
  type: CustomFieldType;
  projectId?: string;
  isRequired?: boolean;
  options?: { value: string }[];
}

export interface CustomFieldUpdateInput {
  name?: string;
  isRequired?: boolean;
  order?: number;
}

export function useCustomFields() {
  return useQuery({
    queryKey: keys.customFields,
    queryFn: async () => (await api.get<CustomField[]>('/custom-fields')).data,
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomFieldCreateInput) =>
      api.post<CustomField>('/custom-fields', input).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customFields });
    },
  });
}

export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CustomFieldUpdateInput }) =>
      api.patch<CustomField>(`/custom-fields/${id}`, patch).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customFields });
    },
  });
}

export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/custom-fields/${id}`).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customFields });
    },
  });
}
