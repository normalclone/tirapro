import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDto } from '@tirapro/types';
import { useProjects } from '@/features/projects/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { LAST_VIEW_KEY } from '@/features/projects/ProjectLayout';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';

/** Có đang gõ trong ô nhập / vùng soạn thảo không → bỏ qua hotkey. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    !!el.closest('[contenteditable="true"]')
  );
}

/** Có dialog/modal nào đang mở không (bảng lệnh, modal…) → bỏ qua hotkey. */
function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [aria-modal="true"], [cmdk-root]');
}

/**
 * Dự án "hiện tại" cho các phím điều hướng: ưu tiên project trong URL (`/p/:key`),
 * rồi view mở gần nhất (localStorage), cuối cùng dự án đầu tiên.
 */
function currentProjectKey(projects: ProjectDto[] | undefined): string | null {
  const m = /^\/p\/([^/]+)/.exec(window.location.pathname);
  if (m) return decodeURIComponent(m[1]);
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) || '{}') as { key?: string };
    if (saved.key && (projects ?? []).some((p) => p.key === saved.key)) return saved.key;
  } catch {
    /* ignore */
  }
  return projects?.[0]?.key ?? null;
}

/** Đưa focus vào ô tìm/bảng lệnh: mở bảng lệnh (⌘K) qua sự kiện dùng chung. */
function focusSearch() {
  window.dispatchEvent(new Event('tirapro:command'));
}

/**
 * Phím tắt toàn cục (mount một lần ở khung ứng dụng):
 *  - `c` mở Tạo issue (dự án hiện tại / đầu tiên)
 *  - `/` focus tìm kiếm (mở bảng lệnh)
 *  - `g b` / `g l` / `g d` đi Board / Backlog / Tổng quan của dự án hiện tại
 *  - `?` mở bảng phím tắt
 * Bỏ qua khi đang gõ trong input/textarea/contenteditable hoặc có dialog đang mở.
 */
export function useGlobalHotkeys() {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  // Giữ tham chiếu mới nhất để listener (đăng ký 1 lần) luôn dùng dữ liệu hiện thời.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    // Chuỗi `g` + phím: nhớ thời điểm bấm `g` để ghép phím kế trong ~1s.
    let awaitingG = 0;

    function onKeyDown(e: KeyboardEvent) {
      // Không chặn tổ hợp có modifier (để ⌘K, copy/paste… hoạt động bình thường).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;

      const key = e.key;

      // Chuỗi "g _": đi tới view của dự án hiện tại.
      if (awaitingG && Date.now() - awaitingG < 1000) {
        awaitingG = 0;
        const seg = key === 'b' ? 'board' : key === 'l' ? 'backlog' : null;
        if (seg) {
          e.preventDefault();
          const pk = currentProjectKey(projectsRef.current);
          if (pk) navigate(`/p/${pk}/${seg}`);
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          navigate('/');
          return;
        }
        // Phím khác sau `g` → bỏ, rơi xuống xử lý thường bên dưới.
      }

      switch (key) {
        case 'g':
          awaitingG = Date.now();
          break;
        case 'c':
          e.preventDefault();
          openCreate({ projectKey: currentProjectKey(projectsRef.current) ?? undefined });
          break;
        case '/':
          e.preventDefault();
          focusSearch();
          break;
        case '?':
          e.preventDefault();
          window.dispatchEvent(new Event(SHORTCUTS_EVENT));
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, openCreate]);
}
