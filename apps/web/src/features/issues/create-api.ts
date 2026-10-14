import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { keys } from '@/lib/queryKeys';

export interface CreateIssueInput {
  projectId: string;
  typeId: string;
  summary: string;
  description?: string | null;
  descriptionFormat: 'MARKDOWN';
  priorityId?: string;
  assigneeId?: string | null;
  parentId?: string | null;
  storyPoints?: number;
  sprintId?: string | null;
  statusId?: string;
  dueDate?: string | null;
}

/** Tạo issue thủ công; invalidate board + danh sách issue khi thành công. */
export function useCreateIssue(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssueInput) =>
      api.post<IssueDto>('/issues', input).then((r) => r.data),
    onSuccess: () => {
      // Board/Backlog/Gantt/Tree dùng chung một cache issue của project + danh sách sprint.
      void qc.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
      void qc.invalidateQueries({ queryKey: keys.sprints.byProject(projectId) });
    },
  });
}
