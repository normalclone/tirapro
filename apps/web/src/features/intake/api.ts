import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';
import type { StatusCategory } from '@tirapro/types';
import type { ReportPayload } from './reportForm';

/** Gợi ý issue có thể trùng với tiêu đề đang gõ (kể cả bug đã đóng — "bug cũ tái diễn"). */
export interface DuplicateSuggestion {
  id: string;
  key: string;
  summary: string;
  occurrenceCount: number;
  triageState: string | null;
  status: { name: string; category: StatusCategory };
  closed: boolean;
  /** Cách giải quyết (khi đã đóng). */
  resolution: string | null;
  severity: { id: string; name: string; color: string | null } | null;
  reporterName: string | null;
  createdAt: string;
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

/** Kết quả gửi báo lỗi: tạo issue mới, hoặc nội dung được thêm thành bình luận vào bug đã có. */
export type ReportIssueResult =
  | { deduped: false; issueId: string; key: string }
  | {
      deduped: true;
      issueId: string;
      key: string;
      occurrenceCount: number;
      commentId: string;
      /** `chosen` = người dùng chọn bug cũ; `auto` = server thấy tiêu đề giống hệt. */
      merged: 'chosen' | 'auto';
    };

export type ReportIssueInput = ReportPayload & { attachmentIds?: string[] };

/**
 * Kiểm tra trùng lặp theo tiêu đề. Chỉ chạy khi đã gõ ≥4 ký tự.
 * Query keyed theo summary → tự cache theo từng chuỗi; staleTime nhỏ giữ kết quả tươi.
 */
export function useDuplicateCheck(projectId: string | undefined, summary: string) {
  const q = summary.trim();
  return useQuery({
    queryKey: keys.triage.duplicates(projectId ?? '', q),
    queryFn:
      projectId && q.length >= 4
        ? async () =>
            (
              await api.get<DuplicateSuggestion[]>('/intake/duplicates', {
                params: { projectId, summary: q },
              })
            ).data
        : skipToken,
    staleTime: 10_000,
  });
}

/** Gửi báo lỗi / yêu cầu: tạo mới, hoặc thêm ghi chú vào bug đã có (nội dung của người báo luôn được giữ). */
export function useReportIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReportIssueInput) =>
      (await api.post<ReportIssueResult>('/intake/report', input)).data,
    onSuccess: (res, input) => {
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(input.projectId) });
      void qc.invalidateQueries({ queryKey: keys.triage.all });
      if (res.deduped) {
        void qc.invalidateQueries({ queryKey: keys.issues.comments(res.issueId) });
        void qc.invalidateQueries({ queryKey: keys.issues.attachments(res.issueId) });
      }
    },
  });
}

const ACTIVITY_PAGE_SIZE = 40;

/**
 * Feed hoạt động của dự án — phân trang keyset theo cursor (endCursor = id dòng cuối).
 * Trang đầu limit 40; "Tải thêm" nạp trang kế qua `fetchNextPage`.
 */
export function useProjectActivity(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: keys.projects.activity(projectId ?? ''),
    queryFn: projectId
      ? async ({ pageParam }) =>
          (
            await api.get<ProjectActivityResponse>(`/projects/${projectId}/activity`, {
              params: { limit: ACTIVITY_PAGE_SIZE, cursor: pageParam ?? undefined },
            })
          ).data
      : skipToken,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo.hasNextPage ? last.pageInfo.endCursor : undefined),
  });
}
