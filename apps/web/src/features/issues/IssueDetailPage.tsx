import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  ArrowLeft,
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
import { useDevLinks, useIssue } from './api';
import { useCreateIssue } from './create-api';
import { useProjects } from '@/features/projects/api';
import { ProjectRail } from '@/features/projects/ProjectRail';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useMyWorkspaces } from '@/features/workspace/api';
import { useDeleteIssue } from '@/features/issue-edit/api';
import { IssueRelations } from '@/features/tree/IssueRelations';
import { CustomFieldsPanel } from '@/features/issue-fields/CustomFieldsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
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
} from '@/features/issue-edit/IssueProperties';
import { IssueDescription } from '@/features/issue-edit/DescriptionEditor';
import { useIssueTransitions } from './useIssueTransitions';
import { LazyPanel } from './LazyPanel';
import { useCanEditRestricted } from './useCanEditRestricted';
import { ActivityTabs } from './ActivityTabs';
import { FOCUS_COMMENT_EVENT } from '@/features/command/events';
import { ConfirmDialog } from './ConfirmDialog';
import { WorklogPanel } from './WorklogPanel';
import { IssueLabelsPicker } from '@/features/issue-meta/IssueLabelsPicker';
import { IssueComponentsPicker } from '@/features/issue-meta/IssueComponentsPicker';
import { DelayedSpinner, EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/stores/auth';
import { PresenceAvatars } from '@/features/presence/PresenceAvatars';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useRecents } from '@/stores/recentIssues';
import { useProjectRealtime } from '@/lib/realtime';
import { useCachedProjectIssue, useUpdateIssue } from './api';
import { isOverlayOpen, isTypingTarget, isWorklogHotkey } from '@/lib/hotkeys';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
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

/** Nút trên thanh thao tác dưới tiêu đề (secondary, viền). */
const TOOLBAR_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50';

const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/** Trang chi tiết công việc (URL /issue/:key) — rail dự án + nội dung + panel thông tin bên phải. */
export function IssueDetailPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const openCreate = useCreateIssueModal((s) => s.openCreate);

  const { data: issue, isLoading, isError } = useIssue(key);
  const can = useCanIn(issue?.projectId);
  const canEditThis = useCanEditIssue(issue?.projectId)(issue ?? {});
  const canTransition = can('issue:transition');
  const { data: devLinks } = useDevLinks(issue?.id);
  // Mã issue theo LOẠI (BUG-4…) → KHÔNG suy ra project key từ chuỗi; resolve theo projectId.
  // Kể cả dự án đã lưu trữ (danh sách mặc định chỉ có dự án hoạt động → breadcrumb trống, "Tạo việc con" sai dự án).
  const { data: projects } = useProjects(true);
  const project = projects?.find((p) => p.id === issue?.projectId) ?? null;
  const projectKey = project?.key ?? '';
  // Trang chi tiết nằm ngoài ProjectLayout → tự nhận realtime của project chứa issue này.
  useProjectRealtime(issue?.projectId);
  // Việc cha chỉ để hiện breadcrumb: đọc từ cache dự án (có sẵn khi đi từ board sang) mà KHÔNG tải cả danh sách việc.
  const parentId = issue?.parentId ?? null;
  const { data: parent = null } = useCachedProjectIssue(issue?.projectId, (list) => {
    const p = parentId ? list.find((i) => i.id === parentId) : undefined;
    return p ? { key: p.key, summary: p.summary } : null;
  });
  const updateIssue = useUpdateIssue(issue?.projectId);
  const createIssue = useCreateIssue(issue?.projectId ?? '');
  const removeIssue = useDeleteIssue();

  const { nextStatuses, changeStatus, isPending: transitionPending } = useIssueTransitions(issue);

  const [editingSummary, setEditingSummary] = useState(false);
  const [summary, setSummary] = useState('');
  const [activityTab, setActivityTab] = useState<'comments' | 'history'>('comments');
  const [wfOpen, setWfOpen] = useState(false);
  const [wfSeen, setWfSeen] = useState(false); // đã từng mở → giữ dialog trong cây để hiệu ứng đóng chạy được
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (issue) setSummary(issue.summary);
  }, [issue?.id]);

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

  async function cloneIssue() {
    if (!issue) return;
    try {
      const created = await createIssue.mutateAsync({
        projectId: issue.projectId,
        typeId: issue.type.id,
        summary: `${issue.summary} (bản sao)`,
        description: issue.description ?? null,
        descriptionFormat: 'MARKDOWN',
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
  const shortcutsEnabled = !wfOpen && !confirmDelete && !editingSummary;
  useEffect(() => {
    if (!shortcutsEnabled) return;
    function onKey(e: KeyboardEvent) {
      if (!issue || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable)
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
        copyLink();
        return;
      }
      const n = Number(e.key);
      if (!canTransition || !Number.isInteger(n) || n < 1 || n > nextStatuses.length) return;
      const opt = nextStatuses[n - 1];
      if (opt) {
        e.preventDefault();
        changeStatus(opt.id);
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

  function copyLink() {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => toast.success('Đã sao chép liên kết. Dán vào chat hoặc email để chia sẻ.'))
      .catch(() =>
        toast.error('Trình duyệt chặn sao chép — hãy chép thủ công đường dẫn trên thanh địa chỉ.'),
      );
  }

  function copyKey() {
    navigator.clipboard
      ?.writeText(key)
      .then(() => toast.success(`Đã sao chép mã ${key}`))
      .catch(() =>
        toast.error(
          'Trình duyệt chặn sao chép — hãy chép thủ công mã hiển thị trên thanh điều hướng.',
        ),
      );
  }

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

  function jumpToComments() {
    setActivityTab('comments');
    requestAnimationFrame(() =>
      document
        .getElementById('issue-activity')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  // Cmd+K "Thêm bình luận": mở tab bình luận, cuộn tới khu hoạt động rồi đưa con trỏ vào ô viết bình luận.
  // Khu này dựng lười (chỉ khi cuộn tới gần) nên thử lại ngắn cho tới khi ô nhập xuất hiện.
  useEffect(() => {
    let timer: number | undefined;
    function onFocusComment() {
      setActivityTab('comments');
      requestAnimationFrame(() =>
        document
          .getElementById('issue-activity')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
      let tries = 0;
      const attempt = () => {
        const box = document.querySelector<HTMLTextAreaElement>(
          '#issue-activity textarea[placeholder^="Viết bình luận"]',
        );
        if (box) {
          box.focus({ preventScroll: true });
          return;
        }
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

  async function saveSummary() {
    if (!issue || summary.trim() === issue.summary) {
      setEditingSummary(false);
      return;
    }
    try {
      await updateIssue.mutateAsync({
        id: issue.id,
        key: issue.key,
        patch: { summary: summary.trim() },
        version: issue.version,
      });
      setEditingSummary(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

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

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar dự án — luôn hiển thị để giữ ngữ cảnh (giống Jira) */}
      <ProjectRail activeKey={projectKey} view="board" />

      <div className="min-w-0 flex-1 overflow-auto">
        <div className={pageContainer('xl', 'py-6')}>
          {/* Breadcrumb + Theo dõi + Xoá */}
          <div className="mb-4 flex items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Quay lại">
              <ArrowLeft className="h-4 w-4" />
              Quay lại
            </Button>
            <nav
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-muted"
              aria-label="Breadcrumb"
            >
              <WorkspaceName />
              <span className="text-faint">/</span>
              {project ? (
                <Link to={`/p/${project.key}/board`} className="truncate hover:text-ink">
                  {project.name}
                </Link>
              ) : (
                <span className="font-mono">{projectKey}</span>
              )}
              {parent && (
                <>
                  <span className="text-faint">/</span>
                  <Link
                    to={`/issue/${parent.key}`}
                    className="truncate font-mono hover:text-ink"
                    title={`Việc cha: ${parent.summary}`}
                  >
                    {parent.key}
                  </Link>
                </>
              )}
              <span className="text-faint">/</span>
              <span className="font-mono text-ink">{key}</span>
              <button
                type="button"
                onClick={copyKey}
                title={`Sao chép mã công việc (${key}) để dán vào chat, commit…`}
                aria-label="Sao chép mã công việc"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Hash className="h-3.5 w-3.5" />
              </button>
            </nav>
          </div>

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

          {isError && (
            <EmptyState
              title="Không tìm thấy công việc này"
              description={`Không có công việc mã ${key}, hoặc bạn chưa được cấp quyền xem. Kiểm tra lại mã, hoặc nhờ quản trị dự án cấp quyền.`}
            />
          )}

          {isLoading || !issue ? (
            <DelayedSpinner />
          ) : (
            <>
              {/* Tiêu đề: [Loại][Ưu tiên] tên — dòng phụ: Sprint · Điểm ước lượng · Nhãn */}
              <div className="mb-4">
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 flex shrink-0 items-center gap-1.5">
                    <IssueTypeSelect issue={issue} />
                    <IssuePrioritySelect issue={issue} />
                  </div>
                  {editingSummary ? (
                    <Input
                      autoFocus
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      onBlur={saveSummary}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveSummary();
                      }}
                      className="h-10 text-2xl font-semibold tracking-tight"
                    />
                  ) : (
                    <h1
                      className={cn(
                        '-mx-1 min-w-0 flex-1 rounded px-1 text-2xl font-semibold tracking-tight',
                        canEditThis && 'cursor-text hover:bg-surface-2',
                      )}
                      onClick={canEditThis ? () => setEditingSummary(true) : undefined}
                      title={canEditThis ? 'Bấm để sửa tiêu đề' : undefined}
                    >
                      {issue.summary}
                    </h1>
                  )}
                  <div className="mt-1 flex shrink-0 items-center gap-2">
                    <PresenceAvatars room="issue" projectId={issue.projectId} issueId={issue.id} />
                    <IssueSlaBadge issueId={issue.id} />
                    <WatchButton issueId={issue.id} />
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <IssueSprintSubtitle issue={issue} />
                  <span className="text-faint" aria-hidden>
                    ·
                  </span>
                  <IssueStoryPointsInline issue={issue} canEditRestricted={canEditRestricted} />
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
                  title="Xuống khu bình luận để trao đổi về việc này"
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
                    title="Đặt bạn làm người phụ trách · phím i"
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
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2"
                      >
                        <Link2 className="h-4 w-4 text-muted" /> Sao chép liên kết
                      </DropdownMenu.Item>
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
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
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
                          onClick={() => changeStatus(o.id)}
                          title={
                            i < 9
                              ? `Chuyển sang “${o.name}” · phím tắt ${i + 1}`
                              : `Chuyển sang “${o.name}”`
                          }
                          className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }}
                            aria-hidden
                          />
                          {o.name}
                          {i < 9 && (
                            <kbd
                              aria-hidden
                              className="ml-0.5 grid h-4 min-w-4 place-items-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] leading-none text-faint transition-colors group-hover:border-primary/40 group-hover:text-primary"
                            >
                              {i + 1}
                            </kbd>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* Thân: trái = mô tả + nội dung + hoạt động; phải = người liên quan + mốc thời gian */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-5">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted">Mô tả</p>
                    <IssueDescription issue={issue} />
                  </div>

                  {/* Danh sách bước nhỏ — nhẹ hơn việc con, chỉ để tick cho xong */}
                  <LazyPanel>
                    <ChecklistPanel issueId={issue.id} projectId={issue.projectId} owner={issue} />
                  </LazyPanel>

                  <LazyPanel>
                    <IssueRelations issue={issue} />
                  </LazyPanel>

                  {/* Thành phần & phiên bản + các trường do dự án tự thêm */}
                  <IssueComponentsPicker issue={issue} />
                  <CustomFieldsPanel issueId={issue.id} canEdit={canEditThis} />

                  {devLinks && devLinks.length > 0 && (
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
                    <IssuePeoplePanel issue={issue} />
                    <IssueDatesPanel issue={issue} canEditRestricted={canEditRestricted} />
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

              <ConfirmDialog
                open={confirmDelete}
                title={`Xoá công việc ${issue.key}?`}
                description="Công việc sẽ biến mất khỏi bảng và mọi danh sách. Dữ liệu vẫn được giữ lại phía hệ thống — nhờ quản trị khôi phục nếu bạn xoá nhầm."
                confirmLabel="Xoá công việc"
                loading={removeIssue.isPending}
                onConfirm={() => void onDelete()}
                onCancel={() => setConfirmDelete(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tên không gian làm việc hiện tại cho breadcrumb. */
function WorkspaceName() {
  const wsId = useAuth((s) => s.workspaceId);
  const { data: workspaces } = useMyWorkspaces();
  const name = workspaces?.find((w) => w.id === wsId)?.name;
  return <span className="truncate">{name ?? 'Không gian làm việc'}</span>;
}
