import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProjects } from '@/features/projects/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { currentProjectKey, resolveCreateTarget } from './currentProject';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';
import { isDialogOpen, isTypingTarget } from './hotkeys';

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
          {
            // Dự án hiện tại đã lưu trữ → đổi sang dự án hoạt động đầu tiên (kèm báo) hoặc chỉ báo, không mở dialog trống.
            const t = resolveCreateTarget(
              currentProjectKey(projectsRef.current),
              projectsRef.current,
            );
            if (t.notice) toast.info(t.notice);
            if (!t.block) openCreate({ projectKey: t.projectKey });
          }
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
