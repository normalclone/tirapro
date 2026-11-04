import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ProjectsView = 'list' | 'groups';

/** localStorage: chế độ xem trang Dự án ("Danh sách" / "Theo nhóm") — theo người dùng trên trình duyệt này. */
const VIEW_KEY = 'tirapro:projectsView';

export const PROJECTS_VIEW_LABEL: Record<ProjectsView, string> = {
  list: 'Danh sách',
  groups: 'Theo nhóm',
};

export function parseView(raw: string | null | undefined): ProjectsView | null {
  return raw === 'list' || raw === 'groups' ? raw : null;
}

function readStored(): ProjectsView | null {
  try {
    return parseView(localStorage.getItem(VIEW_KEY));
  } catch {
    return null;
  }
}

function writeStored(v: ProjectsView): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ignore: chỉ là tiện ích, không có vẫn chạy */
  }
}

/**
 * Chế độ xem: `?view=` trên đường dẫn thắng (liên kết/chuyển hướng cũ `/projects?view=groups`), sau đó là lựa chọn đã
 * nhớ, mặc định "Danh sách". Đổi chế độ = nhớ lại + ghi vào `?view=` (thay thế, không thêm mục lịch sử).
 */
export function useProjectsView(): [ProjectsView, (v: ProjectsView) => void] {
  const [params, setParams] = useSearchParams();
  const [stored] = useState(readStored);
  const view = parseView(params.get('view')) ?? stored ?? 'list';
  const set = useCallback(
    (v: ProjectsView) => {
      writeStored(v);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', v);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [view, set];
}
