import { useCallback, useEffect, useState } from 'react';
import type { IssueDto } from '@tirapro/types';

/** Bộ lọc nhanh có thể bật/tắt độc lập; nhiều bộ bật cùng lúc = AND. */
export type QuickFilterId = 'mine' | 'overdue' | 'unassigned';

export const QUICK_FILTERS: { id: QuickFilterId; label: string }[] = [
  { id: 'mine', label: 'Của tôi' },
  { id: 'overdue', label: 'Quá hạn' },
  { id: 'unassigned', label: 'Chưa gán' },
];

const LS_KEY = 'tirapro:quickFilters';

function readStored(): Set<QuickFilterId> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return new Set();
    const valid = new Set(QUICK_FILTERS.map((f) => f.id));
    return new Set(raw.filter((v): v is QuickFilterId => typeof v === 'string' && valid.has(v as QuickFilterId)));
  } catch {
    return new Set();
  }
}

/**
 * Trạng thái bộ lọc nhanh, tự khôi phục từ localStorage khi mount và lưu lại mỗi lần
 * đổi. Dùng chung cho board + backlog để hành vi nhất quán.
 */
export function useQuickFilters() {
  const [active, setActive] = useState<Set<QuickFilterId>>(() => readStored());

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...active]));
    } catch {
      /* ignore quota/private-mode */
    }
  }, [active]);

  const toggle = useCallback((id: QuickFilterId) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setActive(new Set()), []);

  return { active, toggle, clear };
}

/** Một issue có "quá hạn" không: có hạn, hạn đã qua, và chưa DONE. */
function isOverdue(issue: IssueDto, now: number): boolean {
  if (!issue.dueDate) return false;
  if (issue.status.category === 'DONE') return false;
  const due = new Date(issue.dueDate).getTime();
  return Number.isFinite(due) && due < now;
}

/**
 * Lọc client-side theo các bộ lọc đang bật (AND). `userId` = người dùng hiện tại
 * cho bộ "Của tôi". Trả về mảng mới (không đột biến đầu vào).
 */
export function applyQuickFilters(
  issues: IssueDto[],
  active: Set<QuickFilterId>,
  userId: string | undefined,
): IssueDto[] {
  if (active.size === 0) return issues;
  const now = Date.now();
  return issues.filter((issue) => {
    if (active.has('mine') && issue.assigneeId !== userId) return false;
    if (active.has('overdue') && !isOverdue(issue, now)) return false;
    if (active.has('unassigned') && issue.assigneeId) return false;
    return true;
  });
}
