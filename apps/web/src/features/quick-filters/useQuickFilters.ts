import { useCallback, useEffect, useState } from 'react';
import type { IssueDto } from '@tirapro/types';

/** Bộ lọc nhanh có thể bật/tắt độc lập; bật nhiều bộ cùng lúc thì việc phải khớp TẤT CẢ. */
export type QuickFilterId = 'mine' | 'overdue' | 'unassigned';

/** `hint` hiện trong tooltip của chip — nói rõ bộ lọc giữ lại những việc nào. */
export const QUICK_FILTERS: { id: QuickFilterId; label: string; hint: string }[] = [
  { id: 'mine', label: 'Của tôi', hint: 'Chỉ hiện việc bạn đang phụ trách' },
  { id: 'overdue', label: 'Quá hạn', hint: 'Chỉ hiện việc đã qua hạn mà chưa xong' },
  { id: 'unassigned', label: 'Chưa gán', hint: 'Chỉ hiện việc chưa có ai nhận' },
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

/** Một công việc có "quá hạn" không: có đặt hạn, hạn đã qua, và việc chưa xong. */
function isOverdue(issue: IssueDto, now: number): boolean {
  if (!issue.dueDate) return false;
  if (issue.status.category === 'DONE') return false;
  const due = new Date(issue.dueDate).getTime();
  return Number.isFinite(due) && due < now;
}

/**
 * Lọc phía trình duyệt theo các bộ lọc đang bật (việc phải khớp tất cả). `userId` = người dùng
 * hiện tại, dùng cho bộ "Của tôi". Trả về mảng mới (không đột biến đầu vào).
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
