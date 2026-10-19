import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  GitCommit,
  GitPullRequest,
  GitBranch,
  Hash,
  Link2,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { uncheckAllTasks } from '@tirapro/shared';
import { useDevLinks, useIssue } from './api';
import { useCreateIssue } from './create-api';
import { useProjects } from '@/features/projects/api';
import { ProjectRail } from '@/features/projects/ProjectRail';
import { useCanEditIssue, useCanIn, useProjectPermissions } from '@/features/projects/permissions';
import { useMyWorkspaces } from '@/features/workspace/api';
import { useDeleteIssue, useRetractIssue } from '@/features/issue-edit/api';
import { RetractMenuItem } from './RetractMenuItem';
import { IssueSummaryEdit } from './IssueSummaryEdit';
import { CATEGORY_COLOR, IssueKeyFacts, OtherFactsDisclosure } from './IssueKeyFacts';
import { factLayout } from './issueFacts';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useIssueCopy } from './useIssueCopy';
import { IssueRelations } from '@/features/tree/IssueRelations';
import { CustomFieldsPanel } from '@/features/issue-fields/CustomFieldsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
import { RelatedDocsPanel } from '@/features/issue-widgets/RelatedDocsPanel';
import { ChecklistPanel } from '@/features/issue-extras/ChecklistPanel';
import { IssueSlaBadge } from '@/features/sla/IssueSlaBadge';
import { WatchButton } from '@/features/issue-widgets/WatchButton';
import {
  IssuePeoplePanel,
  IssueDatesPanel,
  IssueSprintSubtitle,
  IssueStoryPointsInline,
  IssueTypeSelect,
  IssuePrioritySelect,
  IssueSeveritySelect,
  IssueResolutionSelect,
} from '@/features/issue-edit/IssueProperties';
import { AcceptanceCriteria } from '@/features/issue-edit/AcceptanceCriteria';
import { IssueDescription } from '@/features/issue-edit/DescriptionEditor';
import { useIssueTransitions } from './useIssueTransitions';
import { LazyPanel } from './LazyPanel';
import { useCanEditRestricted } from './useCanEditRestricted';
import { ActivityTabs } from './ActivityTabs';
import {
  COMMENT_INPUT_ID,
  FOCUS_COMMENT_EVENT,
  REQUEST_TRANSITION_EVENT,
  requestFocusComment,
  type RequestTransitionDetail,
} from '@/features/command/events';
import { ConfirmDialog } from './ConfirmDialog';
import { WorklogPanel } from './WorklogPanel';
import { IssueLabelsPicker } from '@/features/issue-meta/IssueLabelsPicker';
import { EpicParentField } from '@/features/issue-meta/EpicParentField';
import { isEpicIssue } from '@/lib/issueRefs';
import { IssueComponentsPicker } from '@/features/issue-meta/IssueComponentsPicker';
import { EnvironmentPanel } from '@/features/issue-edit/EnvironmentPanel';
import { DelayedSpinner } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { IssueNotFound } from './IssueNotFound';
import { issueViewState } from './issueViewState';
import { apiErrorCode } from '@/lib/api';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { PresenceAvatars } from '@/features/presence/PresenceAvatars';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useRecents } from '@/stores/recentIssues';
import { useProjectRealtime } from '@/lib/realtime';
import { useCachedProjectIssue, useUpdateIssue } from './api';
import { withKey } from '@/lib/shortcuts';
import { isCommentHotkey, isOverlayOpen, isTypingTarget, isWorklogHotkey } from '@/lib/hotkeys';
import { apiErrorMessage } from '@/lib/api';
import { FEATURES } from '@/lib/features';
import type { WorkflowViewDialog as WorkflowViewDialogType } from '@/features/workflow-settings/WorkflowViewDialog';

/** Sơ đồ quy trình kéo theo reactflow (nặng) → chỉ tải khi người dùng bấm “Xem quy trình”. */
const WorkflowViewDialog = lazy<ComponentType<ComponentProps<typeof WorkflowViewDialogType>>>(() =>
  import('@/features/workflow-settings/WorkflowViewDialog')
    .then((m) => ({ default: m.WorkflowViewDialog }))
    .catch(() => {
      // Tải chunk lỗi (mất mạng / bản mới vừa phát hành): báo rõ thay vì ném lỗi lúc vẽ làm trắng trang.
      toast.error('Không tải được sơ đồ quy trình. Kiểm tra mạng rồi tải lại trang để thử lại.');
      return { default: () => null };
    }),
);

/** Câu báo khi bấm `e` mà không sửa được công việc (cùng tinh thần với phím `a`). */
const EDIT_DENIED_NOTICE = 'Bạn không có quyền sửa công việc này.';

/** Nút trên thanh thao tác dưới tiêu đề (secondary, viền). */
const TOOLBAR_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-bg disabled:text-disabled-fg';

/** Trang chi tiết công việc (URL /issue/:key) — rail dự án + nội dung + panel thông tin bên phải. */
export function IssueDetailPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const openCreate = useCreateIssueModal((s) => s.openCreate);

  const {
    data: issue,
    isLoading,
    isError,
    error: issueError,
    refetch: refetchIssue,
  } = useIssue(key);
  const viewState = issueViewState({
    isError,
    isLoading,
    hasData: !!issue,
    notFound: apiErrorCode(issueError) === 'NOT_FOUND',
  });
  const can = useCanIn(issue?.projectId);
  const canEditThis = useCanEditIssue(issue?.projectId)(issue ?? {});
  const canTransition = can('issue:transition');
  // Thuộc tính chính: dưới lg hiện dải ngay dưới tiêu đề + "Thuộc tính khác"; từ lg như trước. Chọn bằng media query để
  // MỖI control chỉ dựng một lần (không trùng id/focus/phím tắt), thay vì dựng hai bản rồi ẩn bằng CSS.
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  const layout = factLayout(isDesktop);
  const { data: devLinks } = useDevLinks(FEATURES.repos ? issue?.id : undefined);
  // Mã issue theo LOẠI (BUG-4…) → KHÔNG suy ra project key từ chuỗi; resolve theo projectId.
  // Kể cả dự án đã lưu trữ (danh sách mặc định chỉ có dự án hoạt động → breadcrumb trống, "Tạo việc con" sai dự án).
  const { data: projects } = useProjects(true);
  const project = projects?.find((p) => p.id === issue?.projectId) ?? null;
  const projectKey = project?.key ?? '';
  const workspaceName = useWorkspaceName();
  // Trang chi tiết nằm ngoài ProjectLayout → tự nhận realtime của project chứa issue này.
  useProjectRealtime(issue?.projectId);
  // Việc cha chỉ để hiện breadcrumb: đọc từ cache dự án (có sẵn khi đi từ board sang) mà KHÔNG tải cả danh sách việc.
  // Cha trong cây = `parentId ?? epicId` (việc gắn epic nhưng không có cha thường vẫn hiện epic ở breadcrumb).
  const parentLinkId = issue?.parentId ?? issue?.epicId ?? null;
  const { data: parent = null } = useCachedProjectIssue(issue?.projectId, (list) => {
    const p = parentLinkId ? list.find((i) => i.id === parentLinkId) : undefined;
    return p ? { key: p.key, summary: p.summary, isEpic: isEpicIssue(p) } : null;
  });
  const updateIssue = useUpdateIssue(issue?.projectId);
  const createIssue = useCreateIssue(issue?.projectId ?? '');
  const removeIssue = useDeleteIssue();
  const retractIssue = useRetractIssue();

  const {
    nextStatuses,
    requestTransition,
    dialog: transitionDialog,
    dialogOpen: transitionDialogOpen,
    isPending: transitionPending,
  } = useIssueTransitions(issue);

  // Ô sửa tiêu đề do InlineText quản lý; trang chỉ biết "đang sửa" (tắt phím tắt) và yêu cầu mở từ ngoài (phím `e`, state điều hướng).
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryEditRequest, setSummaryEditRequest] = useState(0);
  // Phím `e` ở danh sách điều hướng tới đây kèm `state.editSummary`: mở sẵn ô sửa tiêu đề khi đã biết được sửa (quyền tải xong).
  const location = useLocation();
  const editRequested = useRef(
    (location.state as { editSummary?: boolean } | null)?.editSummary === true,
  );
  const permsQ = useProjectPermissions(issue?.projectId);
  const permsSettled = permsQ.isSuccess || permsQ.isError;
  useEffect(() => {
    if (!editRequested.current || !issue || !permsSettled) return;
    editRequested.current = false;
    if (canEditThis) {
      setSummaryEditRequest((n) => n + 1);
    } else toast.info(EDIT_DENIED_NOTICE);
    // Xoá cờ khỏi history để tải lại/Back không tự mở ô sửa lần nữa.
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
  }, [issue, canEditThis, permsSettled, navigate, location.pathname, location.search]);
  const [activityTab, setActivityTab] = useState<'comments' | 'history'>('comments');
  const [wfOpen, setWfOpen] = useState(false);
  const [wfSeen, setWfSeen] = useState(false); // đã từng mở → giữ dialog trong cây để hiệu ứng đóng chạy được
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRetract, setConfirmRetract] = useState(false);

  // Phím `w` ghi thời gian: đăng ký ở cấp trang vì WorklogPanel chỉ mount khi cuộn tới (LazyPanel).
  // Mỗi lần bấm tăng `worklogRequest` → ép dựng panel, cuộn tới và mở form (đếm số để bấm lại sau khi đóng vẫn mở).
  const [worklogRequest, setWorklogRequest] = useState(0);
  const canLogWork = can('worklog:create');
  const hasIssue = !!issue;
  // Sang issue khác → huỷ yêu cầu cũ để panel mới không tự mở form.
  useEffect(() => {
    setWorklogRequest(0);
  }, [issue?.id]);
  useEffect(() => {
    if (!canLogWork || !hasIssue) return;
    function onKey(e: KeyboardEvent) {
      if (
        !isWorklogHotkey(e, {
          typing: isTypingTarget(e.target),
          dialogOpen: isOverlayOpen(),
          canLog: canLogWork,
        })
      )
        return;
      e.preventDefault();
      setWorklogRequest((n) => n + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canLogWork, hasIssue]);

  // Phím `m` viết bình luận: cùng cách đăng ký với `w` (khu bình luận dựng lười nên bắt phím ở cấp trang).
  const canComment = can('comment:create');
  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;
  useEffect(() => {
    if (!canComment || !hasIssue) return;
    function onKey(e: KeyboardEvent) {
      if (
        !isCommentHotkey(e, {
          typing: isTypingTarget(e.target),
          dialogOpen: isOverlayOpen(),
          canComment,
        })
      )
        return;
      e.preventDefault(); // chữ "m" không lọt vào ô vừa được focus
      requestFocusComment();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canComment, hasIssue]);

  // Cmd+K gửi sự kiện cửa sổ; ref để bộ nghe luôn gọi bản mới nhất của requestTransition (không đăng ký lại mỗi lần render).
  const requestTransitionRef = useRef(requestTransition);
  requestTransitionRef.current = requestTransition;
  useEffect(() => {
    function onRequest(e: Event) {
      const d = (e as CustomEvent<RequestTransitionDetail>).detail;
      if (d?.toStatusId) requestTransitionRef.current(d.toStatusId);
    }
    window.addEventListener(REQUEST_TRANSITION_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_TRANSITION_EVENT, onRequest);
  }, []);

  async function cloneIssue() {
    if (!issue) return;
    try {
      const created = await createIssue.mutateAsync({
        projectId: issue.projectId,
        typeId: issue.type.id,
        summary: `${issue.summary} (bản sao)`,
        description: issue.description ?? null,
        descriptionFormat: 'MARKDOWN',
        // Bản sao giữ nội dung tiêu chí nhưng bỏ tick (việc mới chưa đạt gì).
        acceptanceCriteria: issue.acceptanceCriteria
          ? uncheckAllTasks(issue.acceptanceCriteria)
          : undefined,
        priorityId: issue.priority?.id || undefined,
        storyPoints: issue.storyPoints ?? undefined,
        sprintId: issue.sprintId || undefined,
      });
      toast.success(`Đã tạo bản sao: ${created.key}`);
      navigate(`/issue/${created.key}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  // Phím tắt 1..9 = chuyển nhanh sang trạng thái ở bước kế tiếp.
  // Chỉ bind khi KHÔNG có overlay mở (dialog quy trình / xác nhận xoá) và không gõ trong ô nhập.
  const shortcutsEnabled =
    !wfOpen && !confirmDelete && !confirmRetract && !editingSummary && !transitionDialogOpen;
  useEffect(() => {
    if (!shortcutsEnabled) return;
    function onKey(e: KeyboardEvent) {
      if (!issue || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el?.isContentEditable ||
        el?.closest?.('[data-inline-edit]')
      )
        return;
      // Chặn khi còn overlay/menu Radix đang MỞ (dialog đã đóng nhưng còn chạy hiệu ứng không chặn).
      if (isOverlayOpen()) return;
      // i = gán cho tôi, y = sao chép liên kết.
      if ((e.key === 'i' || e.key === 'I') && canEditThis) {
        e.preventDefault();
        assignToMe();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        copyLinkRef.current();
        return;
      }
      // e = sửa tiêu đề tại chỗ (cùng đường với bấm vào tiêu đề); preventDefault để chữ "e" không lọt vào ô vừa mở.
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        if (!canEditThis) {
          toast.info(EDIT_DENIED_NOTICE);
          return;
        }
        setSummaryEditRequest((n) => n + 1);
        return;
      }
      const n = Number(e.key);
      if (!canTransition || !Number.isInteger(n) || n < 1 || n > nextStatuses.length) return;
      const opt = nextStatuses[n - 1];
      if (opt) {
        e.preventDefault();
        requestTransition(opt.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shortcutsEnabled,
    nextStatuses,
    issue?.status.id,
    issue?.version,
    canTransition,
    canEditThis,
  ]);

  const { copyKey, copyLink, keyCopied } = useIssueCopy(issue?.key ?? key);
  // Bộ nghe phím (effect ở trên) không đăng ký lại khi đổi công việc cùng status/version → đọc copyLink mới nhất qua ref.
  const copyLinkRef = useRef(copyLink);
  copyLinkRef.current = copyLink;

  const isMine = !!issue && !!me && issue.assigneeId === me.id;
  function assignToMe() {
    if (!issue || !me || issue.assigneeId === me.id) return;
    updateIssue.mutate(
      { id: issue.id, key: issue.key, patch: { assigneeId: me.id }, version: issue.version },
      {
        onSuccess: () => toast.success('Đã giao việc này cho bạn', { duration: 2000 }),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  // Ghi vào "xem gần đây" mỗi khi mở/đổi issue.
  useEffect(() => {
    if (issue) useRecents.getState().record({ key: issue.key, summary: issue.summary });
  }, [issue?.id, issue?.summary]);

  // Một đường chung với phím `m` và Cmd+K: listener bên dưới mở tab, cuộn, rồi đặt con trỏ vào ô viết.
  function jumpToComments() {
    requestFocusComment();
  }

  // Cmd+K "Thêm bình luận": mở tab bình luận, cuộn tới khu hoạt động rồi đưa con trỏ vào ô viết bình luận.
  // Khu này dựng lười (chỉ khi cuộn tới gần) nên thử lại ngắn cho tới khi ô nhập xuất hiện.
  useEffect(() => {
    let timer: number | undefined;
    function onFocusComment() {
      setActivityTab('comments');
      const commentBox = () =>
        document.getElementById(COMMENT_INPUT_ID) as HTMLTextAreaElement | null;
      const loaded = (box: HTMLElement | null) => !!box?.closest('[data-comments-loaded="true"]');
      // Cuộn tới đầu khu hoạt động để dựng khu lười/tab — bỏ qua nếu ô viết đã sẵn sàng (cuộn đầu khu sẽ đè cuộn tới ô).
      requestAnimationFrame(() => {
        if (loaded(commentBox())) return;
        document
          .getElementById('issue-activity')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      let tries = 0;
      const attempt = () => {
        const box = commentBox();
        // Chờ danh sách bình luận nạp xong (ô nằm cuối danh sách); quá ~1.2s thì cứ focus (vd nạp lỗi).
        if (box && (loaded(box) || tries >= 15)) {
          // Ô viết nằm CUỐI danh sách bình luận: cuộn tới giữa màn hình rồi mới focus (không để focus tự cuộn).
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
          box.focus({ preventScroll: true });
          box.setSelectionRange(box.value.length, box.value.length); // gõ tiếp ở cuối bản nháp
          return;
        }
        // Không có quyền thì không có ô — khỏi chờ đủ 2s (đợi chút phòng quyền chưa nạp xong).
        if (tries >= 6 && !canCommentRef.current) return;
        if (++tries < 25) timer = window.setTimeout(attempt, 80);
      };
      attempt();
    }
    window.addEventListener(FOCUS_COMMENT_EVENT, onFocusComment);
    return () => {
      window.removeEventListener(FOCUS_COMMENT_EVENT, onFocusComment);
      window.clearTimeout(timer);
    };
  }, []);

  const canEditRestricted = useCanEditRestricted(issue);

  async function onDelete() {
    if (!issue) return;
    try {
      await removeIssue.mutateAsync({ id: issue.id, key: issue.key, projectId: issue.projectId });
      setConfirmDelete(false);
      toast.success(`Đã xoá công việc ${issue.key}`);
      navigate(projectKey ? `/p/${projectKey}/board` : '/');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function onRetract() {
    if (!issue) return;
    try {
      await retractIssue.mutateAsync({ id: issue.id, key: issue.key, projectId: issue.projectId });
      setConfirmRetract(false);
      toast.success(`Đã thu hồi công việc ${issue.key}`, {
        description: 'Quản trị dự án có thể khôi phục từ Thùng rác nếu cần.',
      });
      navigate(projectKey ? `/p/${projectKey}/board` : '/');
    } catch (e) {
      setConfirmRetract(false);
      toast.error(apiErrorMessage(e));
    }
  }

  const showIssue =
    !!issue && viewState !== 'not-found' && viewState !== 'error' && viewState !== 'loading';

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar dự án — luôn hiển thị để giữ ngữ cảnh (giống Jira) */}
      <ProjectRail activeKey={projectKey} view="board" />

      <div className="min-w-0 flex-1 overflow-auto">
        <PageFrame size="lg" className="py-6">
          {/*
           * Đã có công việc: không vẽ tiêu đề ở đây — h1 là chính ô tiêu đề hiển thị bên dưới (title-less: chỉ breadcrumb +
           * actions). Đang tải/lỗi/không thấy: chưa có ô đó nên dùng h1 sr-only (`titleHidden`) → mọi trạng thái đúng một h1.
           */}
          <PageHeader
            titleHidden={!showIssue}
            title={showIssue ? undefined : key}
            breadcrumb={[
              { label: workspaceName },
              project
                ? { label: project.name, to: `/p/${project.key}/board` }
                : { label: projectKey, mono: true },
              ...(parent
                ? [
                    {
                      label: parent.key,
                      to: `/issue/${parent.key}`,
                      mono: true,
                      title: `${parent.isEpic ? 'Epic' : 'Việc cha'}: ${parent.summary}`,
                    },
                  ]
                : []),
              { label: key, mono: true },
            ]}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(-1)}
                  aria-label="Quay lại"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Quay lại
                </Button>
                <button
                  type="button"
                  onClick={copyKey}
                  title={`Sao chép mã công việc (${key}) để dán vào chat, commit…`}
                  aria-label="Sao chép mã công việc"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
                >
                  {keyCopied ? (
                    <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                  ) : (
                    <Hash className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            }
          />

          {project?.archivedAt && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-warning/10 px-3 py-2 text-sm text-ink"
            >
              <Archive className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="font-medium">Dự án đã lưu trữ — chỉ đọc.</span>
              <span className="text-muted">Không sửa, chuyển trạng thái hay bình luận được.</span>
            </div>
          )}

          {viewState === 'not-found' ? (
            <IssueNotFound issueKey={key} />
          ) : viewState === 'error' ? (
            <QueryError error={issueError} onRetry={() => void refetchIssue()} />
          ) : viewState === 'loading' || !issue ? (
            <DelayedSpinner />
          ) : (
            <>
              {/* Tiêu đề: [Loại][Ưu tiên] tên — dòng phụ: Sprint · Điểm ước lượng · Nhãn */}
              <div className="mb-4">
                {/* Mobile: [Loại/Ưu tiên…] + hành động cùng một hàng, tiêu đề xuống hàng riêng đủ rộng (order). */}
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:items-start">
                  <div className="order-1 flex shrink-0 flex-wrap items-center gap-1.5 sm:mt-1.5">
                    <IssueTypeSelect issue={issue} />
                    {layout.priorityInHeader && <IssuePrioritySelect issue={issue} />}
                    <IssueSeveritySelect issue={issue} />
                    <IssueResolutionSelect issue={issue} />
                  </div>
                  {/* h1 của trang = tiêu đề hiển thị (InlineText as="h1"; đang sửa thì h1 bọc ô nhập, vẫn đúng một h1). */}
                  <IssueSummaryEdit
                    key={issue.id}
                    issue={issue}
                    canEdit={canEditThis}
                    as="h1"
                    className="order-3 basis-full sm:order-2 sm:basis-0 sm:flex-1"
                    textClassName="text-xl font-semibold tracking-tight sm:text-2xl"
                    inputClassName="h-10 text-xl font-semibold tracking-tight sm:text-2xl"
                    title={withKey('Bấm để sửa tiêu đề', 'issue.edit')}
                    editRequest={summaryEditRequest}
                    onEditingChange={setEditingSummary}
                  />
                  <div className="order-2 ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:ml-0 sm:mt-1">
                    <PresenceAvatars room="issue" projectId={issue.projectId} issueId={issue.id} />
                    <IssueSlaBadge issueId={issue.id} />
                    <WatchButton issueId={issue.id} />
                  </div>
                </div>
                {layout.strip.length > 0 && (
                  <IssueKeyFacts
                    issue={issue}
                    canEditRestricted={canEditRestricted}
                    canTransition={canTransition}
                    nextStatuses={nextStatuses}
                    transitionPending={transitionPending}
                    onTransition={requestTransition}
                    onOpenWorkflow={() => {
                      setWfSeen(true);
                      setWfOpen(true);
                    }}
                  />
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <IssueSprintSubtitle issue={issue} />
                  <span className="text-faint" aria-hidden>
                    ·
                  </span>
                  <IssueStoryPointsInline issue={issue} canEdit={canEditThis} />
                  <span className="text-faint" aria-hidden>
                    ·
                  </span>
                  <IssueLabelsPicker issue={issue} inline />
                </div>
              </div>

              {/* Thanh nút thao tác dưới tiêu đề */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={TOOLBAR_BTN}
                  title={withKey('Xuống khu bình luận và viết ngay', 'issue.comment')}
                  onClick={jumpToComments}
                >
                  <MessageSquare className="h-4 w-4" /> Bình luận
                </button>

                {can('issue:create') && (
                  <button
                    type="button"
                    className={TOOLBAR_BTN}
                    title="Tách một phần việc nhỏ nằm bên trong công việc này"
                    onClick={() => openCreate({ projectKey, parentId: issue.id, subtask: true })}
                  >
                    <ListTree className="h-4 w-4" /> Tạo việc con
                  </button>
                )}
                {can('issue:create') && (
                  <button
                    type="button"
                    className={TOOLBAR_BTN}
                    title="Tạo một công việc mới giống hệt việc này để sửa lại cho nhanh"
                    onClick={() => void cloneIssue()}
                    disabled={createIssue.isPending}
                  >
                    <Copy className="h-4 w-4" /> Tạo bản sao
                  </button>
                )}
                {me && !isMine && canEditThis && (
                  <button
                    type="button"
                    className={TOOLBAR_BTN}
                    onClick={assignToMe}
                    disabled={updateIssue.isPending}
                    title={withKey('Đặt bạn làm người phụ trách', 'issue.assignMe')}
                  >
                    <UserPlus className="h-4 w-4" /> Gán cho tôi
                  </button>
                )}

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={TOOLBAR_BTN}
                      title="Thao tác khác với công việc này"
                    >
                      <MoreHorizontal className="h-4 w-4" /> Thêm
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="start"
                      sideOffset={6}
                      className="z-dropdown w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150"
                    >
                      <DropdownMenu.Item
                        onSelect={() => copyLink()}
                        title={withKey('Sao chép liên kết công việc', 'issue.copyLink')}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
                      >
                        <Link2 className="h-4 w-4 text-muted" /> Sao chép liên kết
                      </DropdownMenu.Item>
                      <RetractMenuItem
                        issue={issue}
                        meId={me?.id}
                        can={can}
                        onSelect={() => setConfirmRetract(true)}
                      />
                      {can('issue:delete') && (
                        <DropdownMenu.Item
                          onSelect={() => setConfirmDelete(true)}
                          disabled={removeIssue.isPending}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-danger outline-none transition-colors data-[highlighted]:bg-danger/10"
                        >
                          <Trash2 className="h-4 w-4" /> Xoá công việc
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Trạng thái hiện tại + xem quy trình, rồi các bước chuyển kế tiếp (theo workflow) */}
                {layout.statusInToolbar && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {/* Chip trạng thái (từ lg; dưới lg đã ở dải thuộc tính) */}
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-ink"
                      title="Trạng thái hiện tại của công việc"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: CATEGORY_COLOR[issue.status.category] ?? 'var(--faint)',
                        }}
                        aria-hidden
                      />
                      {issue.status.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setWfSeen(true);
                        setWfOpen(true);
                      }}
                      aria-label="Xem quy trình"
                      title="Xem quy trình: các trạng thái có thể có và bước chuyển hợp lệ"
                      className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <Workflow className="h-4 w-4" />
                    </button>
                    {canTransition && nextStatuses.length > 0 && (
                      <>
                        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                        {nextStatuses.map((o, i) => (
                          <button
                            key={o.id}
                            type="button"
                            disabled={transitionPending}
                            onClick={() => requestTransition(o.id)}
                            title={`${
                              o.label !== o.name
                                ? `${o.label} → “${o.name}”`
                                : `Chuyển sang “${o.name}”`
                            }${i < 9 ? ` · phím tắt ${i + 1}` : ''}`}
                            className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled-bg disabled:text-disabled-fg"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }}
                              aria-hidden
                            />
                            {o.label}
                            {i < 9 && (
                              <kbd
                                aria-hidden
                                className="kbd-hint ml-0.5 grid h-4 min-w-4 place-items-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] leading-none text-faint transition-colors group-hover:border-primary/40 group-hover:text-primary"
                              >
                                {i + 1}
                              </kbd>
                            )}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Dưới lg: phần còn lại của cột phải gom vào "Thuộc tính khác" (thu gọn mặc định), ngay trên thân trang. */}
              {layout.other.length > 0 && (
                <OtherFactsDisclosure>
                  <EpicParentField issue={issue} />
                  <IssuePeoplePanel issue={issue} omit={layout.strip} />
                  <IssueDatesPanel
                    issue={issue}
                    canEditRestricted={canEditRestricted}
                    omit={layout.strip}
                  />
                </OtherFactsDisclosure>
              )}

              {/* Thân: trái = mô tả + nội dung + hoạt động; phải = người liên quan + mốc thời gian */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-5">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted">Mô tả</p>
                    <IssueDescription issue={issue} />
                  </div>

                  {/* Story luôn có khối này (kể cả rỗng); loại khác chỉ khi đã có nội dung */}
                  {(issue.type.key === 'STORY' || issue.acceptanceCriteria) && (
                    <AcceptanceCriteria issue={issue} />
                  )}

                  {/* Danh sách bước nhỏ — nhẹ hơn việc con, chỉ để tick cho xong */}
                  <LazyPanel>
                    <ChecklistPanel issueId={issue.id} projectId={issue.projectId} owner={issue} />
                  </LazyPanel>

                  <LazyPanel>
                    <IssueRelations issue={issue} />
                  </LazyPanel>

                  {/* Thành phần & phiên bản + các trường do dự án tự thêm */}
                  <IssueComponentsPicker issue={issue} />
                  <EnvironmentPanel issue={issue} />
                  <CustomFieldsPanel issueId={issue.id} canEdit={canEditThis} />

                  {FEATURES.repos && devLinks && devLinks.length > 0 && (
                    <div>
                      <p
                        className="mb-2 text-sm font-medium text-muted"
                        title="Nhánh, commit và pull request trên kho mã có nhắc tới mã công việc này"
                      >
                        Liên kết code ({devLinks.length})
                      </p>
                      <div className="space-y-1.5">
                        {devLinks.map((d) => {
                          const Icon =
                            d.type === 'PULL_REQUEST'
                              ? GitPullRequest
                              : d.type === 'BRANCH'
                                ? GitBranch
                                : GitCommit;
                          return (
                            <a
                              key={d.id}
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-2"
                            >
                              <Icon className="h-4 w-4 shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate text-ink">
                                {d.title || d.externalId}
                              </span>
                              {d.branch && (
                                <span className="shrink-0 font-mono text-xs text-faint">
                                  {d.branch}
                                </span>
                              )}
                              {d.authorName && (
                                <span className="shrink-0 text-xs text-muted">{d.authorName}</span>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <LazyPanel minHeight={64}>
                    <LinksPanel issueId={issue.id} canEdit={canEditThis} />
                  </LazyPanel>
                  <LazyPanel minHeight={64}>
                    <RelatedDocsPanel issue={issue} />
                  </LazyPanel>
                  <LazyPanel minHeight={64}>
                    <AttachmentsPanel issueId={issue.id} canEdit={canEditThis} />
                  </LazyPanel>

                  {/* Hoạt động: tab Bình luận / Lịch sử */}
                  <LazyPanel id="issue-activity" minHeight={160}>
                    <ActivityTabs issue={issue} tab={activityTab} onTab={setActivityTab} />
                  </LazyPanel>
                </div>

                {/* Cột phải: Người liên quan + Mốc thời gian */}
                <aside className="min-w-0">
                  <div className="space-y-5 lg:sticky lg:top-4">
                    {layout.sidebar.length > 0 && (
                      <>
                        <EpicParentField issue={issue} />
                        <IssuePeoplePanel issue={issue} />
                        <IssueDatesPanel issue={issue} canEditRestricted={canEditRestricted} />
                      </>
                    )}
                    <LazyPanel id="issue-worklog" minHeight={96} force={worklogRequest > 0}>
                      <WorklogPanel issue={issue} openRequest={worklogRequest} />
                    </LazyPanel>
                  </div>
                </aside>
              </div>

              {wfSeen && (
                <Suspense fallback={null}>
                  <WorkflowViewDialog
                    open={wfOpen}
                    onClose={() => setWfOpen(false)}
                    currentStatusId={issue.status.id}
                    currentStatusName={issue.status.name}
                  />
                </Suspense>
              )}

              {transitionDialog}
              <ConfirmDialog
                open={confirmDelete}
                title={`Xoá công việc ${issue.key}?`}
                description="Công việc sẽ biến mất khỏi bảng và mọi danh sách. Dữ liệu vẫn được giữ lại phía hệ thống — nhờ quản trị khôi phục nếu bạn xoá nhầm."
                confirmLabel="Xoá công việc"
                loading={removeIssue.isPending}
                onConfirm={() => void onDelete()}
                onCancel={() => setConfirmDelete(false)}
              />
              <ConfirmDialog
                open={confirmRetract}
                title={`Thu hồi công việc ${issue.key}?`}
                description="Công việc sẽ biến mất khỏi bảng và mọi danh sách. Bạn không tự khôi phục được — quản trị dự án có thể khôi phục từ Thùng rác nếu cần."
                confirmLabel="Thu hồi công việc"
                loading={retractIssue.isPending}
                onConfirm={() => void onRetract()}
                onCancel={() => setConfirmRetract(false)}
              />
            </>
          )}
        </PageFrame>
      </div>
    </div>
  );
}

/** Tên không gian làm việc hiện tại cho breadcrumb. */
function useWorkspaceName(): string {
  const wsId = useAuth((s) => s.workspaceId);
  const { data: workspaces } = useMyWorkspaces();
  return workspaces?.find((w) => w.id === wsId)?.name ?? 'Không gian làm việc';
}
