import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useProjects } from '@/features/projects/api';
import { useCreateIssueModal } from '@/stores/createIssue';
import {
  CREATE_DENIED_NOTICE,
  createPresetFromTarget,
  currentProjectKey,
  issueKeyFromPathname,
} from './currentProject';
import { useCreateTarget } from './useCreateTarget';
import { SHORTCUTS_EVENT } from '@/components/layout/ShortcutsDialog';
import { activeDrag } from './activeDrag';
import { moveNavFocus } from './listNav';
import { getPeekSource } from './peekRegistry';
import { useIssuePeek } from '@/features/issues/peek/useIssuePeek';
import { PEEK_PARAM } from '@/features/issues/peek/peekParam';
import { requestAssign } from '@/features/quick-assign/events';
import {
  isOverlayOpen,
  isTypingTarget,
  shouldIgnoreGlobalHotkey,
  shouldSkipListHotkey,
} from './hotkeys';

/**
 * Công việc mà phím `a`/`e` nhắm tới: dòng/thẻ đang focus (`data-issue-key` ở chính nó hoặc tổ tiên) → trang `/issue/:key`
 * → công việc đang mở ở panel xem nhanh (`?peek=`).
 */
function targetIssueKey(): string | null {
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-issue-key]');
  const fromRow = focused?.getAttribute('data-issue-key');
  if (fromRow) return fromRow;
  return (
    issueKeyFromPathname(window.location.pathname) ??
    new URLSearchParams(window.location.search).get(PEEK_PARAM)
  );
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
 *  - `j` / `k` dời focus xuống / lên dòng-thẻ kế (phần tử `data-nav-item`)
 *  - `a` gán người phụ trách cho dòng-thẻ đang focus; `e` mở trang công việc để sửa tiêu đề
 * Bỏ qua khi đang gõ trong input/textarea/contenteditable hoặc có lớp phủ đang mở (dialog, menu, popover — trong menu phím chữ là typeahead).
 */
export function useGlobalHotkeys() {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const openCreate = useCreateIssueModal((s) => s.openCreate);
  const { open: openPeek } = useIssuePeek();
  // Giữ tham chiếu mới nhất để listener (đăng ký 1 lần) luôn dùng dữ liệu hiện thời.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const openPeekRef = useRef(openPeek);
  openPeekRef.current = openPeek;
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
        case 'j':
        case 'J':
        case 'k':
        case 'K':
          // Đang kéo bằng bàn phím (Space nhấc thẻ): phím thuộc về dnd-kit, không dời focus.
          if (shouldSkipListHotkey(key, { dragging: !!activeDrag.get(), onIssuePage: false }))
            break;
          {
            // Thứ tự + khung danh sách của trang đang mở (cùng nguồn với nút ‹ › của panel); không có → thứ tự DOM.
            const src = getPeekSource();
            if (
              moveNavFocus(
                key.toLowerCase() === 'j' ? 1 : -1,
                {
                  peekKey: new URLSearchParams(window.location.search).get(PEEK_PARAM),
                  onPeek: openPeekRef.current,
                  order: src?.getOrder() ?? undefined,
                },
                src?.getRoot() ?? document,
              )
            )
              e.preventDefault();
          }
          break;
        case 'a':
        case 'A': {
          if (shouldSkipListHotkey(key, { dragging: !!activeDrag.get(), onIssuePage: false }))
            break;
          const issueKey = targetIssueKey();
          if (issueKey) {
            e.preventDefault();
            requestAssign(issueKey);
          }
          break;
        }
        case 'e':
        case 'E': {
          // Trang công việc tự xử lý `e` (sửa tiêu đề tại chỗ); ở danh sách thì mở trang công việc ở chế độ sửa tiêu đề.
          const onIssuePage = !!issueKeyFromPathname(window.location.pathname);
          if (shouldSkipListHotkey(key, { dragging: !!activeDrag.get(), onIssuePage })) break;
          const issueKey = targetIssueKey();
          if (issueKey) {
            e.preventDefault();
            navigate(`/issue/${issueKey}`, { state: { editSummary: true } });
          }
          break;
        }
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
