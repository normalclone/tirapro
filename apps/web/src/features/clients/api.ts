import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Khoá cache danh sách khách hàng của workspace hiện tại. */
export const clientsKey = ['clients'] as const;

export interface ClientProjectRef {
  id: string;
  key: string;
  name: string;
  isArchived: boolean;
}

export interface ContractDto {
  id: string;
  clientId: string;
  name: string;
  code: string | null;
  value: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  project: { id: string; key: string; name: string } | null;
  createdAt: string;
}

export interface ClientDto {
  id: string;
  workspaceId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  projects: ClientProjectRef[];
  projectCount: number;
  contracts: ContractDto[];
  contractCount: number;
  contractTotals: { currency: string; value: number }[];
  createdAt: string;
}

export interface ClientInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  projectIds?: string[];
}

export interface ContractInput {
  name?: string;
  code?: string | null;
  value?: number | null;
  currency?: string;
  projectId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
}

/** Danh sách khách hàng kèm dự án, hợp đồng và số đếm. */
export function useClients() {
  return useQuery({
    queryKey: clientsKey,
    queryFn: async () => (await api.get<ClientDto[]>('/clients')).data,
  });
}

function useInvalidateClients() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: clientsKey });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (input: ClientInput) => api.post<ClientDto>('/clients', input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, ...input }: ClientInput & { id: string }) =>
      api.put<ClientDto>(`/clients/${id}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Đặt lại toàn bộ tập dự án của một khách hàng. */
export function useSetClientProjects() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, projectIds }: { id: string; projectIds: string[] }) =>
      api.put<ClientDto>(`/clients/${id}/projects`, { projectIds }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useCreateContract() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ clientId, ...input }: ContractInput & { clientId: string }) =>
      api.post<ContractDto>(`/clients/${clientId}/contracts`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateContract() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ clientId, id, ...input }: ContractInput & { clientId: string; id: string }) =>
      api.put<ContractDto>(`/clients/${clientId}/contracts/${id}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteContract() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ clientId, id }: { clientId: string; id: string }) =>
      api.delete(`/clients/${clientId}/contracts/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Định dạng tiền theo chuẩn VN (1.500.000 ₫ / 12.000 USD). */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${new Intl.NumberFormat('vi-VN').format(value)} ${currency}`;
  }
}
