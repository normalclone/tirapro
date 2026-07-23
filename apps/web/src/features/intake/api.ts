import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { boardIssuesKey } from '@/features/board/api';

/** Gợi ý issue có thể trùng với tiêu đề đang gõ. */
export interface DuplicateSuggestion {
  id: string;
  key: string;
  summary: string;
  occurrenceCount: number;
  triageState: string;
}

/** Một mục hoạt động trong feed của dự án. */
export interface ProjectActivityItem {
  id: string;
  issueId: string;
  /** Mã issue đích, vd DEMO-BUG-4 — link tới /issue/:key. */
  issueKey: string;
  /** Tiêu đề issue đích. */
  issueSummary: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  /** Nhãn hiển thị đã phân giải (id user → tên, id sprint → tên); null nếu trống. */
  oldLabel: string | null;
  newLabel: string | null;
  oldCategory: string | null;
  newCategory: string | null;
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  occurredAt: string;
}

interface ProjectActivityResponse {
  success: boolean;
  data: ProjectActivityItem[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** Kết quả gửi báo lỗi: được gộp vào issue trùng, hoặc tạo issue mới. */
export interface ReportIssueResult {
  deduped: boolean;
  issueId: string;
  key?: string;
  occurrenceCount?: number;
}

interface ReportIssueInput {
  projectId: string;
  summary: string;
  description?: string;
  typeId?: string;
}

export const triageKey = ['triage'] as const;

/**
 * Kiểm tra trùng lặp theo tiêu đề. Chỉ chạy khi đã gõ ≥4 ký tự.
 * Query keyed theo summary → tự cache theo từng chuỗi; staleTime nhỏ giữ kết quả tươi.
 */
export function useDuplicateCheck(projectId: string | undefined, summary: string) {
  const q = summary.trim();
  return useQuery({
    queryKey: ['intake-duplicates', projectId ?? '', q],
    queryFn: async () =>
      (
        await api.get<DuplicateSuggestion[]>('/intake/duplicates', {
          params: { projectId, summary: q },
        })
      ).data,
    enabled: !!projectId && q.length >= 4,
    staleTime: 10_000,
  });
}

/** Gửi báo lỗi: server tự quyết định gộp (dedupe) hay tạo mới. */
export function useReportIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReportIssueInput) =>
      (await api.post<ReportIssueResult>('/intake/report', input)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: boardIssuesKey(projectId) });
      void qc.invalidateQueries({ queryKey: triageKey });
    },
  });
}

export const projectActivityKey = (projectId: string) => ['project-activity', projectId] as const;

const ACTIVITY_PAGE_SIZE = 40;

/**
 * Feed hoạt động của dự án — phân trang keyset theo cursor (endCursor = id dòng cuối).
 * Trang đầu limit 40; "Tải thêm" nạp trang kế qua `fetchNextPage`.
 */
export function useProjectActivity(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: projectActivityKey(projectId ?? ''),
    queryFn: async ({ pageParam }) =>
      (
        await api.get<ProjectActivityResponse>(`/projects/${projectId}/activity`, {
          params: { limit: ACTIVITY_PAGE_SIZE, cursor: pageParam ?? undefined },
        })
      ).data,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
    enabled: !!projectId,
  });
}
