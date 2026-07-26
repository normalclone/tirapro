import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Khoá cache danh mục chương trình của workspace hiện tại. */
export const programsKey = ['programs'] as const;
export const programRollupKey = ['programs', 'rollup'] as const;

export interface ProgramProjectRef {
  id: string;
  key: string;
  name: string;
  isArchived: boolean;
}

export interface ProgramDto {
  id: string;
  workspaceId: string;
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

export interface RollupStats {
  issueCount: number;
  doneCount: number;
  inProgressCount: number;
  todoCount: number;
  overdueCount: number;
  progressPct: number;
}

export interface RollupProject extends RollupStats {
  id: string;
  key: string;
  name: string;
  isArchived: boolean;
  leadName: string | null;
  startDate: string | null;
  targetDate: string | null;
}

export interface RollupGroup extends RollupStats {
  /** null = nhóm "Chưa thuộc chương trình". */
  id: string | null;
  name: string;
  color: string | null;
  description: string | null;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  plannedTargetDate: string | null;
  projectCount: number;
  projects: RollupProject[];
}

export interface PortfolioRollup {
  groups: RollupGroup[];
  totals: RollupStats & { projectCount: number; programCount: number };
}

/** Danh sách chương trình (thô — dùng cho modal sửa & bộ lọc). */
export function usePrograms() {
  return useQuery({
    queryKey: programsKey,
    queryFn: async () => (await api.get<ProgramDto[]>('/programs')).data,
  });
}

/** Rollup tiến độ toàn danh mục: chương trình → dự án con, kèm số liệu issue. */
export function useProgramRollup() {
  return useQuery({
    queryKey: programRollupKey,
    queryFn: async () => (await api.get<PortfolioRollup>('/programs/rollup')).data,
  });
}

function useInvalidatePortfolio() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: programsKey });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useCreateProgram() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (input: ProgramInput) => api.post<ProgramDto>('/programs', input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateProgram() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, ...input }: ProgramInput & { id: string }) =>
      api.put<ProgramDto>(`/programs/${id}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteProgram() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/programs/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Đặt lại toàn bộ tập dự án của một chương trình. */
export function useSetProgramProjects() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, projectIds }: { id: string; projectIds: string[] }) =>
      api.put<ProgramDto>(`/programs/${id}/projects`, { projectIds }).then((r) => r.data),
    onSuccess: invalidate,
  });
}
