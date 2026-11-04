import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

interface ProgramProjectRef {
  id: string;
  key: string;
  name: string;
  isArchived: boolean;
}

export interface ProgramDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  owner: { id: string; displayName: string; avatarUrl: string | null } | null;
  startDate: string | null;
  targetDate: string | null;
  projects: ProgramProjectRef[];
  projectCount: number;
  createdAt: string;
}

export interface ProgramInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  ownerId?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  projectIds?: string[];
}

/** Danh sách nhóm dự án (thô — dùng cho modal sửa, popover "Nhóm" và cây "Theo nhóm"). */
export function usePrograms() {
  return useQuery({
    queryKey: keys.programs.all,
    queryFn: async () => (await api.get<ProgramDto[]>('/programs')).data,
  });
}

function useInvalidatePrograms() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.programs.all });
    void qc.invalidateQueries({ queryKey: keys.projects.all });
  };
}

export function useCreateProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (input: ProgramInput) =>
      api.post<ProgramDto>('/programs', input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: ({ id, ...input }: ProgramInput & { id: string }) =>
      api.put<ProgramDto>(`/programs/${id}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteProgram() {
  const invalidate = useInvalidatePrograms();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/programs/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}
