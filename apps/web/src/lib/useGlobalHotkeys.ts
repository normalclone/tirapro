import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProjects } from '@/features/projects/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import { CREATE_DENIED_NOTICE, createPresetFromTarget, currentProjectKey } from './currentProject';
import { useCreateTarget } from './useCreateTarget';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';
import { isOverlayOpen, isTypingTarget, shouldIgnoreGlobalHotkey } from './hotkeys';

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
 * Bỏ qua khi đang gõ trong input/textarea/contenteditable hoặc có lớp phủ đang mở (dialog, menu, popover — trong menu phím chữ là typeahead).
 */
export function useGlobalHotkeys() {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  // Giữ tham chiếu mới nhất để listener (đăng ký 1 lần) luôn dùng dữ liệu hiện thời.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const create = useCreateTarget();
  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    // Chuỗi `g` + phím: nhớ thời điểm bấm `g` để ghép phím kế trong ~1s.
    let awaitingG = 0;

    function onKeyDown(e: KeyboardEvent) {
      // Không chặn tổ hợp có modifier (để ⌘K, copy/paste… hoạt động bình thường), ô nhập, hay menu/dialog đang mở.
      if (
        shouldIgnoreGlobalHotkey(e, {
          typing: isTypingTarget(e.target),
          overlayOpen: isOverlayOpen(),
        })
      )
        return;

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
            // Cùng đích + cùng luật quyền với nút Tạo / Cmd+K / nút nổi (xem `useCreateTarget`).
            const { target: t, access } = createRef.current;
            if (access === 'deny') toast.info(CREATE_DENIED_NOTICE);
            else {
              if (t.notice) toast.info(t.notice);
              if (access === 'open') openCreate(createPresetFromTarget(t));
            }
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
