import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ─────────────────────────── Kiểu dữ liệu ─────────────────────────── */

export interface ResourceUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AllocationDto {
  id: string;
  projectId: string;
  userId: string;
  percent: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  note: string | null;
  createdAt: string;
  project: { id: string; key: string; name: string };
  user: ResourceUser;
}

export type TimeOffKind = 'LEAVE' | 'HOLIDAY' | 'OTHER';

export interface TimeOffDto {
  id: string;
  workspaceId: string;
  /** null = ngày lễ áp dụng cho toàn tổ chức. */
  userId: string | null;
  kind: TimeOffKind;
  startDate: string;
  endDate: string;
  note: string | null;
  createdAt: string;
  user: ResourceUser | null;
}

export interface WorkloadCell {
  weekStart: string;
  capacityHours: number;
  assignedHours: number;
  loggedHours: number;
  workingDays: number;
  offDays: number;
  allocationPercent: number;
  issueCount: number;
  ratio: number | null;
  overloaded: boolean;
}

export interface WorkloadRow {
  user: ResourceUser;
  weeks: WorkloadCell[];
  totals: {
    capacityHours: number;
    assignedHours: number;
    loggedHours: number;
    ratio: number | null;
    overloaded: boolean;
  };
  usesDefaultCapacity: boolean;
}

export interface WorkloadReport {
  from: string;
  to: string;
  projectId: string | null;
  hoursPerDay: number;
  weeks: { start: string; end: string; label: string }[];
  rows: WorkloadRow[];
}

export interface AllocationInput {
  projectId?: string;
  userId?: string;
  percent?: number;
  startDate?: string;
  endDate?: string;
  note?: string | null;
}

export interface TimeOffInput {
  userId?: string | null;
  kind?: TimeOffKind;
  startDate?: string;
  endDate?: string;
  note?: string | null;
}

/* ─────────────────────────── Khoá cache ─────────────────────────── */

export const workloadKey = (p: Record<string, string | undefined>) => ['workload', p] as const;
export const allocationsKey = (p: Record<string, string | undefined>) => ['allocations', p] as const;
export const timeOffKey = (p: Record<string, string | undefined>) => ['time-off', p] as const;

function invalidateResources(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['workload'] });
  void qc.invalidateQueries({ queryKey: ['allocations'] });
  void qc.invalidateQueries({ queryKey: ['time-off'] });
}

/* ─────────────────────────── Hooks ─────────────────────────── */

/** Bảng tải NGƯỜI × TUẦN trong khoảng thời gian đã chọn. */
export function useWorkload(params: { from: string; to: string; projectId?: string }) {
  const p = { from: params.from, to: params.to, projectId: params.projectId || undefined };
  return useQuery({
    queryKey: workloadKey(p),
    queryFn: async () => (await api.get<WorkloadReport>('/resources/workload', { params: p })).data,
  });
}

export function useAllocations(params: { projectId?: string; userId?: string; from?: string; to?: string }) {
  const p = {
    projectId: params.projectId || undefined,
    userId: params.userId || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };
  return useQuery({
    queryKey: allocationsKey(p),
    queryFn: async () => (await api.get<AllocationDto[]>('/resources/allocations', { params: p })).data,
  });
}

export function useCreateAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AllocationInput) => api.post<AllocationDto>('/resources/allocations', input).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

export function useUpdateAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AllocationInput & { id: string }) =>
      api.put<AllocationDto>(`/resources/allocations/${id}`, input).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

export function useDeleteAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/resources/allocations/${id}`).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

export function useTimeOffs(params: { userId?: string; from?: string; to?: string }) {
  const p = {
    userId: params.userId || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };
  return useQuery({
    queryKey: timeOffKey(p),
    queryFn: async () => (await api.get<TimeOffDto[]>('/resources/time-off', { params: p })).data,
  });
}

export function useCreateTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeOffInput) => api.post<TimeOffDto>('/resources/time-off', input).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

export function useUpdateTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: TimeOffInput & { id: string }) =>
      api.put<TimeOffDto>(`/resources/time-off/${id}`, input).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

export function useDeleteTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/resources/time-off/${id}`).then((r) => r.data),
    onSuccess: () => invalidateResources(qc),
  });
}

/* ─────────────────────────── Tiện ích ngày ─────────────────────────── */

/** `YYYY-MM-DD` theo lịch địa phương (khớp cách người dùng đọc ngày). */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Thứ Hai của tuần chứa `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay();
  return addDays(x, dow === 0 ? -6 : 1 - dow);
}

/** `2026-07-24` → `24/07`. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** Số giờ → chuỗi gọn: `0`, `6,5h`, `32h`. */
export function formatHours(h: number): string {
  if (!h) return '0';
  const rounded = Math.round(h * 10) / 10;
  return `${String(rounded).replace('.', ',')}h`;
}
