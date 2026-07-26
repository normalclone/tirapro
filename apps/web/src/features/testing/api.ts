import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IssueDto, ListResponse } from '@tirapro/types';
import { api } from '@/lib/api';

// ───────────────────────── Kiểu dữ liệu ─────────────────────────

export type TestResult = 'UNTESTED' | 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export interface TestUserLite {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
}

export interface TestIssueLite {
  id: string;
  key: string;
  summary: string;
  statusName: string | null;
  statusCategory: string | null;
  typeName: string | null;
}

export interface TestCaseDto {
  id: string;
  projectId: string;
  key: string;
  title: string;
  precondition: string | null;
  steps: string | null;
  expected: string | null;
  folder: string | null;
  owner: TestUserLite | null;
  issues: TestIssueLite[];
  issueCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TestProgress = Record<TestResult, number> & { total: number };

export interface TestRunDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  startedAt: string;
  finishedAt: string | null;
  progress: TestProgress;
}

export interface TestExecutionDto {
  id: string;
  result: TestResult;
  note: string | null;
  executedAt: string | null;
  executedBy: TestUserLite | null;
  bugIssue: TestIssueLite | null;
  testCase: {
    id: string;
    key: string;
    title: string;
    folder: string | null;
    precondition: string | null;
    steps: string | null;
    expected: string | null;
  };
}

export interface TestRunDetailDto extends TestRunDto {
  executions: TestExecutionDto[];
}

export interface TestCaseInput {
  title?: string;
  precondition?: string | null;
  steps?: string | null;
  expected?: string | null;
  folder?: string | null;
  ownerId?: string | null;
  issueIds?: string[];
}

// ───────────────────────── Khoá cache ─────────────────────────

export const testCasesKey = (projectId: string, search: string, folder: string) =>
  ['test-cases', projectId, search, folder] as const;
export const testFoldersKey = (projectId: string) => ['test-folders', projectId] as const;
export const testRunsKey = (projectId: string) => ['test-runs', projectId] as const;
export const testRunKey = (projectId: string, runId: string) => ['test-run', projectId, runId] as const;

const base = (projectId: string) => `/testing/${projectId}`;

/** Giá trị trễ nhịp — gõ tìm kiếm không bắn request mỗi phím. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ───────────────────────── Ca kiểm thử ─────────────────────────

export function useTestCases(projectId: string | undefined, search = '', folder = '') {
  return useQuery({
    queryKey: testCasesKey(projectId ?? '', search, folder),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (folder) params.set('folder', folder);
      const qs = params.toString();
      return (await api.get<TestCaseDto[]>(`${base(projectId!)}/cases${qs ? `?${qs}` : ''}`)).data;
    },
    enabled: !!projectId,
    // Giữ kết quả cũ khi đổi từ khoá → bảng không nháy/trống giữa chừng.
    placeholderData: (prev) => prev,
  });
}

export function useTestFolders(projectId: string | undefined) {
  return useQuery({
    queryKey: testFoldersKey(projectId ?? ''),
    queryFn: async () => (await api.get<string[]>(`${base(projectId!)}/folders`)).data,
    enabled: !!projectId,
  });
}

/** Làm mới mọi truy vấn của tab kiểm thử (danh sách ca, thư mục, đợt chạy). */
function useInvalidateTesting(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['test-cases', projectId] });
    void qc.invalidateQueries({ queryKey: testFoldersKey(projectId) });
    void qc.invalidateQueries({ queryKey: testRunsKey(projectId) });
    void qc.invalidateQueries({ queryKey: ['test-run', projectId] });
  };
}

export function useCreateTestCase(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: (input: TestCaseInput) =>
      api.post<TestCaseDto>(`${base(projectId)}/cases`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateTestCase(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ caseId, ...input }: TestCaseInput & { caseId: string }) =>
      api.put<TestCaseDto>(`${base(projectId)}/cases/${caseId}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteTestCase(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: (caseId: string) => api.delete(`${base(projectId)}/cases/${caseId}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useLinkTestCaseIssues(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ caseId, issueIds }: { caseId: string; issueIds: string[] }) =>
      api.post<TestCaseDto>(`${base(projectId)}/cases/${caseId}/issues`, { issueIds }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUnlinkTestCaseIssues(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ caseId, issueIds }: { caseId: string; issueIds: string[] }) =>
      api
        .delete<TestCaseDto>(`${base(projectId)}/cases/${caseId}/issues`, { data: { issueIds } })
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Tìm issue trong dự án để gắn vào ca kiểm thử (traceability). */
export function useProjectIssueSearch(projectId: string | undefined, search: string) {
  return useQuery({
    queryKey: ['testing-issue-search', projectId, search] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ projectId: projectId!, limit: '20' });
      if (search) params.set('search', search);
      return (await api.get<ListResponse<IssueDto>>(`/issues?${params.toString()}`)).data.data;
    },
    enabled: !!projectId,
    placeholderData: (prev) => prev,
  });
}

// ───────────────────────── Đợt chạy ─────────────────────────

export function useTestRuns(projectId: string | undefined) {
  return useQuery({
    queryKey: testRunsKey(projectId ?? ''),
    queryFn: async () => (await api.get<TestRunDto[]>(`${base(projectId!)}/runs`)).data,
    enabled: !!projectId,
  });
}

export function useTestRun(projectId: string | undefined, runId: string | null) {
  return useQuery({
    queryKey: testRunKey(projectId ?? '', runId ?? ''),
    queryFn: async () => (await api.get<TestRunDetailDto>(`${base(projectId!)}/runs/${runId!}`)).data,
    enabled: !!projectId && !!runId,
  });
}

export function useCreateTestRun(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null; caseIds?: string[] }) =>
      api.post<TestRunDetailDto>(`${base(projectId)}/runs`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateTestRun(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ runId, ...input }: { runId: string; name?: string; description?: string | null; finished?: boolean }) =>
      api.put<TestRunDetailDto>(`${base(projectId)}/runs/${runId}`, input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteTestRun(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: (runId: string) => api.delete(`${base(projectId)}/runs/${runId}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useAddCasesToRun(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ runId, caseIds }: { runId: string; caseIds: string[] }) =>
      api.post<{ success: boolean; added: number }>(`${base(projectId)}/runs/${runId}/cases`, { caseIds }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useRemoveCaseFromRun(projectId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ runId, caseId }: { runId: string; caseId: string }) =>
      api.delete(`${base(projectId)}/runs/${runId}/cases/${caseId}`).then((r) => r.data),
    onSuccess: invalidate,
  });
}

/** Ghi kết quả nhanh cho một ca trong đợt chạy (optimistic: badge đổi ngay). */
export function useSetExecutionResult(projectId: string, runId: string) {
  const qc = useQueryClient();
  const key = testRunKey(projectId, runId);
  return useMutation({
    mutationFn: ({ caseId, result, note }: { caseId: string; result: TestResult; note?: string | null }) =>
      api.put<TestRunDetailDto>(`${base(projectId)}/runs/${runId}/executions/${caseId}`, { result, note }).then((r) => r.data),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TestRunDetailDto>(key);
      if (prev) {
        qc.setQueryData<TestRunDetailDto>(key, {
          ...prev,
          executions: prev.executions.map((e) =>
            e.testCase.id === v.caseId
              ? { ...e, result: v.result, note: v.note !== undefined ? (v.note ?? null) : e.note }
              : e,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (data) => qc.setQueryData(key, data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: testRunsKey(projectId) });
    },
  });
}

/** Tạo issue loại Bug từ một ca KHÔNG ĐẠT (tiêu đề/mô tả lấy từ ca kiểm thử). */
export function useCreateBugFromExecution(projectId: string, runId: string) {
  const invalidate = useInvalidateTesting(projectId);
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string }) =>
      api.post<TestRunDetailDto>(`${base(projectId)}/runs/${runId}/executions/${caseId}/bug`, {}).then((r) => r.data),
    onSuccess: invalidate,
  });
}
