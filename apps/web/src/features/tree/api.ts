import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { api } from '@/lib/api';

/**
 * Đặt/đổi/bỏ issue cha (PATCH parentId, OCC version). Backend chặn vòng lặp.
 * Làm mới rộng (board, backlog/tree, issue) vì thay đổi cây ảnh hưởng nhiều màn.
 */
export function useSetParent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; parentId: string | null; version: number }) =>
      api.patch<IssueDto>(`/issues/${v.id}`, { parentId: v.parentId, version: v.version }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
