import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Ack } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export interface SlaPolicyDto {
  id: string;
  name: string;
  projectId: string | null;
  project?: { id: string; key: string; name: string } | null;
  priorityId: string | null;
  priority?: { id: string; name: string; color: string | null } | null;
  responseMins: number;
  resolveMins: number;
  active: boolean;
}

export interface IssueSlaDto {
  policyName: string;
  responseDueAt: string;
  resolveDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  responseBreached: boolean;
  resolveBreached: boolean;
  responseRemainingMins: number | null;
  resolveRemainingMins: number | null;
}

export interface SlaBoardRow {
  issueId: string;
  key: string;
  summary: string;
  status: { name: string; category: string };
  assignee: { id: string; displayName: string; avatarUrl: string | null } | null;
  priority: { name: string; color: string | null; rank: number } | null;
  policyName: string;
  resolveDueAt: string;
  remainingMins: number;
  responded: boolean;
  responseBreached: boolean;
  resolveBreached: boolean;
}

export function useSlaPolicies() {
  return useQuery({
    queryKey: keys.sla.policies,
    queryFn: async () => (await api.get<SlaPolicyDto[]>('/sla/policies')).data,
  });
}

export function useSlaBoard() {
  return useQuery({
    queryKey: keys.sla.board,
    queryFn: async () => (await api.get<SlaBoardRow[]>('/sla/board')).data,
  });
}

export function useIssueSla(issueId?: string) {
  return useQuery({
    queryKey: keys.issues.sla(issueId ?? ''),
    queryFn: issueId
      ? async () => (await api.get<IssueSlaDto | null>(`/sla/issue/${issueId}`)).data
      : skipToken,
  });
}

export interface SlaPolicyInput {
  name: string;
  projectId?: string | null;
  priorityId?: string | null;
  responseMins: number;
  resolveMins: number;
  active?: boolean;
}

export function useCreateSlaPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SlaPolicyInput) =>
      api.post<SlaPolicyDto[]>('/sla/policies', input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sla.policies }),
  });
}

export function useUpdateSlaPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<SlaPolicyInput> & { id: string }) =>
      api.put<SlaPolicyDto[]>(`/sla/policies/${id}`, input).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sla.policies }),
  });
}

export function useDeleteSlaPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<Ack>(`/sla/policies/${id}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.sla.policies }),
  });
}

/** "2 giờ 30 phút" / "3 ngày" — hiển thị phút thành chuỗi tiếng Việt gọn. */
/**
 * Ngưỡng cảnh báo "sắp tới hạn" (phút). Đổi số ở ĐÂY thì câu chữ trên badge và
 * bảng theo dõi tự đổi theo — đừng ghi cứng "2 giờ" ở nơi khác.
 */
export const SLA_SOON_MINS = 120;

/** Câu mô tả ngưỡng trên, dùng cho nhãn/tooltip. VD: "còn dưới 2 giờ". */
export const SLA_SOON_LABEL = `còn dưới ${SLA_SOON_MINS / 60} giờ`;

export function fmtMins(mins: number): string {
  const abs = Math.abs(mins);
  if (abs < 60) return `${abs} phút`;
  if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m ? `${h} giờ ${m} phút` : `${h} giờ`;
  }
  const d = Math.floor(abs / (60 * 24));
  const h = Math.floor((abs % (60 * 24)) / 60);
  return h ? `${d} ngày ${h} giờ` : `${d} ngày`;
}
