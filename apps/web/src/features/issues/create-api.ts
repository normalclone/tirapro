import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';
import { boardIssuesKey } from '@/features/board/api';

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
      void qc.invalidateQueries({ queryKey: boardIssuesKey(projectId) });
      // Backlog/Tree/Gantt dùng key riêng (['backlog-issues', projectId]) + danh sách sprint.
      void qc.invalidateQueries({ queryKey: ['backlog-issues', projectId] });
      void qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      void qc.invalidateQueries({ queryKey: ['issues'] });
    },
  });
}
