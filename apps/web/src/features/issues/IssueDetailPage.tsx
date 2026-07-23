import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, ChevronRight, Copy, GitCommit, GitPullRequest, GitBranch, Hash, History, Link2, ListTree, MessageSquare, MoreHorizontal, Trash2, UserPlus, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { useDevLinks, useIssue } from './api';
import { useCreateIssue } from './create-api';
import { useProjects } from '@/features/projects/api';
import { ProjectRail } from '@/features/projects/ProjectRail';
import { useMyWorkspaces } from '@/features/workspace/api';
import { useWorkflows } from '@/features/workflow-settings/api';
import { useProjectIssues } from '@/features/backlog/api';
import { useDeleteIssue } from '@/features/issue-edit/api';
import { IssueRelations } from '@/features/tree/IssueRelations';
import { CustomFieldsPanel } from '@/features/issue-fields/CustomFieldsPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityPanel } from '@/features/activity/ActivityPanel';
import { LinksPanel } from '@/features/issue-widgets/LinksPanel';
import { WatchButton } from '@/features/issue-widgets/WatchButton';
import { IssuePeoplePanel, IssueDatesPanel, IssueSprintSubtitle, IssueStoryPointsInline, IssueTypeSelect, IssuePrioritySelect } from '@/features/issue-edit/IssueProperties';
import { IssueDescription } from '@/features/issue-edit/DescriptionEditor';
import { WorkflowViewDialog } from '@/features/workflow-settings/WorkflowViewDialog';
import { CommentsSection } from '@/features/issue-edit/CommentsSection';
import { ConfirmDialog } from './ConfirmDialog';
import { IssueLabelsPicker } from '@/features/issue-meta/IssueLabelsPicker';
import { IssueComponentsPicker } from '@/features/issue-meta/IssueComponentsPicker';
import { DelayedSpinner, EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/stores/auth';
import { useCreateIssueModal } from '@/stores/createIssue';
import { useRecents } from '@/stores/recentIssues';
import { useUpdateIssue, useTransitionDetail } from './api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { IssueDto } from '@tirapro/types';

/** Nút trên thanh thao tác dưới tiêu đề (secondary, viền). */
const TOOLBAR_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50';

const CATEGORY_COLOR: Record<string, string> = {
  TODO: 'var(--status-todo)',
  IN_PROGRESS: 'var(--status-progress)',
  DONE: 'var(--status-done)',
};

/** Trang chi tiết issue (URL /issue/:key) — bố cục kiểu Jira: rail dự án + nội dung + panel chi tiết. */
export function IssueDetailPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const openCreate = useCreateIssueModal((s) => s.openCreate);

  const { data: issue, isLoading, isError } = useIssue(key);
  const { data: devLinks } = useDevLinks(issue?.id);
  // Mã issue theo LOẠI (BUG-4…) → KHÔNG suy ra project key từ chuỗi; resolve theo projectId.
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === issue?.projectId) ?? null;
  const projectKey = project?.key ?? '';
  const { data: projIssues = [] } = useProjectIssues(issue?.projectId);
  const { data: workflows } = useWorkflows();
  const updateIssue = useUpdateIssue(issue?.projectId);
  const transition = useTransitionDetail(issue?.projectId ?? '');
  const createIssue = useCreateIssue(issue?.projectId ?? '');
  const removeIssue = useDeleteIssue();

  // Chỉ các trạng thái ở BƯỚC KẾ TIẾP — chuyển tiếp hợp lệ từ trạng thái hiện tại theo workflow.
  const currentStatusId = issue?.status.id;
  const nextStatuses = useMemo(() => {
    const empty: { id: string; name: string; category: string }[] = [];
    if (!currentStatusId) return empty;
    const wf = (workflows ?? []).find((w) => w.statuses.some((s) => s.id === currentStatusId));
    if (!wf) return empty;
    const byId = new Map(wf.statuses.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const out: { id: string; name: string; category: string }[] = [];
    for (const t of wf.transitions) {
      const applies = t.fromStatusId === currentStatusId || t.fromStatusId == null; // null = "bất kỳ"
      if (!applies || t.toStatusId === currentStatusId || seen.has(t.toStatusId)) continue;
      const s = byId.get(t.toStatusId);
      if (!s) continue;
      seen.add(t.toStatusId);
      out.push({ id: s.id, name: s.name, category: s.category });
    }
    return out;
  }, [workflows, currentStatusId]);

  const [editingSummary, setEditingSummary] = useState(false);
  const [summary, setSummary] = useState('');
  const [activityTab, setActivityTab] = useState<'comments' | 'history'>('comments');
  const [wfOpen, setWfOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (issue) setSummary(issue.summary); }, [issue?.id]);

  function changeStatus(toStatusId: string) {
    if (!issue || toStatusId === issue.status.id) return;
    transition.mutate(
      { id: issue.id, toStatusId, version: issue.version },
      { onSuccess: () => toast.success('Đã đổi trạng thái', { duration: 2000 }), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

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
      toast.success(`Đã tạo bản sao ${created.key}`);
      navigate(`/issue/${created.key}`);
    } catch (e) { toast.error(apiErrorMessage(e)); }
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      // Chặn khi còn overlay/menu Radix đang mở ở đâu đó trên trang.
      if (document.querySelector('[data-radix-popper-content-wrapper],[role="dialog"]')) return;
      // i = gán cho tôi, y = sao chép liên kết.
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); assignToMe(); return; }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); copyLink(); return; }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > nextStatuses.length) return;
      const opt = nextStatuses[n - 1];
      if (opt) { e.preventDefault(); changeStatus(opt.id); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsEnabled, nextStatuses, issue?.status.id, issue?.version]);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => toast.success('Đã sao chép liên kết'))
      .catch(() => toast.error('Không sao chép được liên kết'));
  }

  function copyKey() {
    navigator.clipboard?.writeText(key)
      .then(() => toast.success(`Đã sao chép ${key}`))
      .catch(() => toast.error('Không sao chép được'));
  }

  const isMine = !!issue && !!me && issue.assigneeId === me.id;
  function assignToMe() {
    if (!issue || !me || issue.assigneeId === me.id) return;
    updateIssue.mutate(
      { id: issue.id, key: issue.key, patch: { assigneeId: me.id }, version: issue.version },
      { onSuccess: () => toast.success('Đã gán cho bạn', { duration: 2000 }), onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  // Ghi vào "xem gần đây" mỗi khi mở/đổi issue.
  useEffect(() => {
    if (issue) useRecents.getState().record({ key: issue.key, summary: issue.summary });
  }, [issue?.id, issue?.summary]);

  function jumpToComments() {
    setActivityTab('comments');
    requestAnimationFrame(() =>
      document.getElementById('issue-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  const parent = issue?.parentId ? projIssues.find((i) => i.id === issue.parentId) ?? null : null;
  const canEditRestricted =
    !!issue &&
    (issue.reporterId === me?.id ||
      can('workspace:admin') ||
      can('project:admin') ||
      !!me?.isSystemAdmin);

  async function saveSummary() {
    if (!issue || summary.trim() === issue.summary) { setEditingSummary(false); return; }
    try {
      await updateIssue.mutateAsync({ id: issue.id, key: issue.key, patch: { summary: summary.trim() }, version: issue.version });
      setEditingSummary(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  }

  async function onDelete() {
    if (!issue) return;
    try {
      await removeIssue.mutateAsync(issue.id);
      setConfirmDelete(false);
      toast.success(`Đã xoá ${issue.key}`);
      navigate(projectKey ? `/p/${projectKey}/board` : '/');
    } catch (e) { toast.error(apiErrorMessage(e)); }
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
            <nav className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-muted" aria-label="Breadcrumb">
              <WorkspaceName />
              <span className="text-faint">/</span>
              {project ? (
                <Link to={`/p/${project.key}/board`} className="truncate hover:text-ink">{project.name}</Link>
              ) : (
                <span className="font-mono">{projectKey}</span>
              )}
              {parent && (
                <>
                  <span className="text-faint">/</span>
                  <Link to={`/issue/${parent.key}`} className="truncate font-mono hover:text-ink" title={parent.summary}>{parent.key}</Link>
                </>
              )}
              <span className="text-faint">/</span>
              <span className="font-mono text-ink">{key}</span>
              <button
                type="button"
                onClick={copyKey}
                title="Sao chép mã issue"
                aria-label="Sao chép mã issue"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Hash className="h-3.5 w-3.5" />
              </button>
            </nav>
          </div>

          {isError && <EmptyState title="Không tìm thấy issue" description={`Không có issue ${key} hoặc bạn không có quyền xem.`} />}

          {isLoading || !issue ? (
            <DelayedSpinner />
          ) : (
            <>
              {/* Tiêu đề: [Loại][Ưu tiên] tên — dòng phụ: Sprint · Story points · Nhãn */}
              <div className="mb-4">
                <div className="flex items-start gap-2">
                  <div className="mt-1.5 flex shrink-0 items-center gap-1.5">
                    <IssueTypeSelect issue={issue} />
                    <IssuePrioritySelect issue={issue} />
                  </div>
                  {editingSummary ? (
                    <Input
                      autoFocus value={summary} onChange={(e) => setSummary(e.target.value)}
                      onBlur={saveSummary} onKeyDown={(e) => { if (e.key === 'Enter') saveSummary(); }}
                      className="h-10 text-2xl font-semibold tracking-tight"
                    />
                  ) : (
                    <h1
                      className="-mx-1 min-w-0 flex-1 cursor-text rounded px-1 text-2xl font-semibold tracking-tight hover:bg-surface-2"
                      onClick={() => setEditingSummary(true)}
                      title="Bấm để sửa"
                    >
                      {issue.summary}
                    </h1>
                  )}
                  <span className="mt-1 shrink-0"><WatchButton issueId={issue.id} /></span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <IssueSprintSubtitle issue={issue} />
                  <span className="text-faint" aria-hidden>·</span>
                  <IssueStoryPointsInline issue={issue} canEditRestricted={canEditRestricted} />
                  <span className="text-faint" aria-hidden>·</span>
                  <IssueLabelsPicker issue={issue} inline />
                </div>
              </div>

              {/* Thanh nút thao tác dưới tiêu đề (giống Jira) */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <button type="button" className={TOOLBAR_BTN} onClick={jumpToComments}>
                  <MessageSquare className="h-4 w-4" /> Bình luận
                </button>

                <button type="button" className={TOOLBAR_BTN} onClick={() => openCreate({ projectKey, parentId: issue.id, subtask: true })}>
                  <ListTree className="h-4 w-4" /> Tạo sub-task
                </button>
                <button type="button" className={TOOLBAR_BTN} onClick={() => void cloneIssue()} disabled={createIssue.isPending}>
                  <Copy className="h-4 w-4" /> Tạo bản sao
                </button>
                {me && !isMine && (
                  <button type="button" className={TOOLBAR_BTN} onClick={assignToMe} disabled={updateIssue.isPending} title="Gán cho tôi · phím i">
                    <UserPlus className="h-4 w-4" /> Gán cho tôi
                  </button>
                )}

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" className={TOOLBAR_BTN}>
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
                      <DropdownMenu.Item
                        onSelect={() => setConfirmDelete(true)}
                        disabled={removeIssue.isPending}
                        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-danger outline-none transition-colors data-[highlighted]:bg-danger/10"
                      >
                        <Trash2 className="h-4 w-4" /> Xoá issue
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>

                {/* Trạng thái hiện tại + xem quy trình, rồi các bước chuyển kế tiếp (theo workflow) */}
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-ink">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[issue.status.category] ?? 'var(--faint)' }} aria-hidden />
                    {issue.status.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWfOpen(true)}
                    aria-label="Xem quy trình"
                    title="Xem quy trình"
                    className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <Workflow className="h-4 w-4" />
                  </button>
                  {nextStatuses.length > 0 && (
                    <>
                      <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                      {nextStatuses.map((o, i) => (
                        <button
                          key={o.id}
                          type="button"
                          disabled={transition.isPending}
                          onClick={() => changeStatus(o.id)}
                          title={i < 9 ? `Chuyển sang “${o.name}” · phím tắt ${i + 1}` : `Chuyển sang “${o.name}”`}
                          className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[o.category] ?? 'var(--faint)' }} aria-hidden />
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

              {/* Thân (kiểu Jira Server): trái = Chi tiết + thuộc tính + mô tả + hoạt động; phải = Con người + Ngày */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-5">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted">Mô tả</p>
                    <IssueDescription issue={issue} />
                  </div>

                  <IssueRelations issue={issue} />

                  {/* Thành phần & phiên bản + trường tuỳ chỉnh */}
                  <IssueComponentsPicker issue={issue} />
                  <CustomFieldsPanel issueId={issue.id} />

                  {devLinks && devLinks.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium text-muted">Liên kết code ({devLinks.length})</p>
                      <div className="space-y-1.5">
                        {devLinks.map((d) => {
                          const Icon = d.type === 'PULL_REQUEST' ? GitPullRequest : d.type === 'BRANCH' ? GitBranch : GitCommit;
                          return (
                            <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-2">
                              <Icon className="h-4 w-4 shrink-0 text-muted" />
                              <span className="min-w-0 flex-1 truncate text-ink">{d.title || d.externalId}</span>
                              {d.branch && <span className="shrink-0 font-mono text-xs text-faint">{d.branch}</span>}
                              {d.authorName && <span className="shrink-0 text-xs text-muted">{d.authorName}</span>}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <LinksPanel issueId={issue.id} />
                  <AttachmentsPanel issueId={issue.id} />

                  {/* Hoạt động: tab Bình luận / Lịch sử */}
                  <div id="issue-activity">
                    <ActivityTabs issue={issue} tab={activityTab} onTab={setActivityTab} />
                  </div>
                </div>

                {/* Cột phải: Con người + Ngày (kiểu Jira Server) */}
                <aside className="min-w-0">
                  <div className="space-y-5 lg:sticky lg:top-4">
                    <IssuePeoplePanel issue={issue} />
                    <IssueDatesPanel issue={issue} canEditRestricted={canEditRestricted} />
                  </div>
                </aside>
              </div>

              <WorkflowViewDialog
                open={wfOpen}
                onClose={() => setWfOpen(false)}
                currentStatusId={issue.status.id}
                currentStatusName={issue.status.name}
              />

              <ConfirmDialog
                open={confirmDelete}
                title={`Xoá issue ${issue.key}?`}
                description="Issue sẽ được xoá mềm và gỡ khỏi bảng. Liên hệ quản trị nếu cần khôi phục."
                confirmLabel="Xoá issue"
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

/** Khu hoạt động với tab Bình luận / Lịch sử (controlled). */
function ActivityTabs({ issue, tab, onTab }: { issue: IssueDto; tab: 'comments' | 'history'; onTab: (t: 'comments' | 'history') => void }) {
  const tabCls = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium transition-colors',
      active ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
    );
  return (
    <div>
      <div className="mb-4 flex items-center gap-5 border-b border-border">
        <button type="button" className={tabCls(tab === 'comments')} onClick={() => onTab('comments')}>
          <MessageSquare className="h-4 w-4" /> Bình luận
        </button>
        <button type="button" className={tabCls(tab === 'history')} onClick={() => onTab('history')}>
          <History className="h-4 w-4" /> Lịch sử
        </button>
      </div>
      {tab === 'comments' ? <CommentsSection issue={issue} /> : <ActivityPanel issueId={issue.id} />}
    </div>
  );
}

/** Tên workspace hiện tại cho breadcrumb. */
function WorkspaceName() {
  const wsId = useAuth((s) => s.workspaceId);
  const { data: workspaces } = useMyWorkspaces();
  const name = workspaces?.find((w) => w.id === wsId)?.name;
  return <span className="truncate">{name ?? 'Workspace'}</span>;
}
