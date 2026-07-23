import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string; // tira_xxxxxxxxxx (phần công khai)
  scopes: string[]; // ['read'] | ['read','write']
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}
export interface CreatedApiKey extends ApiKey {
  key: string; // khoá đầy đủ — chỉ trả về 1 lần
}
export interface CreateApiKeyInput {
  name: string;
  write?: boolean;
  expiresInDays?: number;
}

const KEY = ['api-keys'] as const;

/** Envelope list backend: { success, data, pageInfo, meta }. */
interface ListEnvelope<T> {
  data: T[];
}

export function useApiKeys() {
  return useQuery({ queryKey: KEY, queryFn: async () => (await api.get<ListEnvelope<ApiKey>>('/api-keys')).data.data });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateApiKeyInput) => (await api.post<CreatedApiKey>('/api-keys', input)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<{ ok: true }>(`/api-keys/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
