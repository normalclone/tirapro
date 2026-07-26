import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type RaidKind = 'RISK' | 'ASSUMPTION' | 'ISSUE' | 'DEPENDENCY';
export type RaidStatus = 'OPEN' | 'MITIGATING' | 'CLOSED' | 'ACCEPTED';
export type RaidLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RaidOwner {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

export interface RaidItemDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: { id: string; key: string; name: string } | null;
  kind: RaidKind;
  title: string;
  description: string | null;
  probability: number;
  impact: number;
  status: RaidStatus;
  owner: RaidOwner | null;
  mitigation: string | null;
  dueDate: string | null;
  /** probability × impact (1..25). */
  score: number;
  level: RaidLevel;
  levelLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface RaidInput {
  kind?: RaidKind;
  title?: string;
  description?: string | null;
  probability?: number;
  impact?: number;
  status?: RaidStatus;
  projectId?: string | null;
  ownerId?: string | null;
  mitigation?: string | null;
  dueDate?: string | null;
}

export interface RaidFilter {
  kind?: RaidKind | '';
  status?: RaidStatus | '';
  projectId?: string;
}

export const raidRootKey = ['raid'] as const;
export const raidKey = (filter: RaidFilter) => ['raid', filter] as const;

function cleanParams(filter: RaidFilter): Record<string, string> {
  const p: Record<string, string> = {};
  if (filter.kind) p.kind = filter.kind;
  if (filter.status) p.status = filter.status;
  if (filter.projectId) p.projectId = filter.projectId;
  return p;
}

/** Sổ RAID của workspace (đã sắp theo điểm rủi ro giảm dần). */
export function useRaidItems(filter: RaidFilter) {
  return useQuery({
    queryKey: raidKey(filter),
    queryFn: async () => (await api.get<RaidItemDto[]>('/raid', { params: cleanParams(filter) })).data,
  });
}

function useInvalidateRaid() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: raidRootKey });
}

export function useCreateRaidItem() {
  const invalidate = useInvalidateRaid();
  return useMutation({
    mutationFn: async (input: RaidInput) => (await api.post<RaidItemDto>('/raid', input)).data,
    onSuccess: invalidate,
  });
}

export function useUpdateRaidItem() {
  const invalidate = useInvalidateRaid();
  return useMutation({
    mutationFn: async ({ id, ...input }: RaidInput & { id: string }) =>
      (await api.put<RaidItemDto>(`/raid/${id}`, input)).data,
    onSuccess: invalidate,
  });
}

export function useDeleteRaidItem() {
  const invalidate = useInvalidateRaid();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/raid/${id}`)).data,
    onSuccess: invalidate,
  });
}
