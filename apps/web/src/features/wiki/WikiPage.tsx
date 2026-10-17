import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  Lock,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { setTaskChecked } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/useConfirm';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { MarkdownEditor } from '@/features/issue-edit/MarkdownEditor';
import { MarkdownView } from '@/features/issue-edit/MarkdownView';
import { useProjects } from '@/features/projects/api';
import { useLazyProjectCan, useProjectsCan } from '@/features/projects/permissions';
import { pageContainer } from '@/components/layout/page';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { currentProjectKey } from '@/lib/currentProject';
import { cn } from '@/lib/utils';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/stores/auth';
import {
  WIKI_SCOPE_SHARED,
  useCreateWikiPage,
  useDeleteWikiPage,
  useMoveWikiPage,
  useUpdateWikiPage,
  useWikiAdmins,
  useWikiPage,
  useWikiSearch,
  useWikiTree,
  type WikiNode,
  type WikiPageDetail,
} from './api';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { fmtDateTime } from '@/lib/dateFormat';
import { canWriteAt, noWriteMessage, projectIdsToCheck, writeLoadingAt } from './wikiScope';
import { WikiHistoryDialog } from './WikiHistoryDialog';
import { RestoreDraftBanner } from './RestoreDraftBanner';
import { useWikiDraft } from './useWikiDraft';
import { WikiTrashDialog } from './WikiTrashDialog';

/** Vị trí của một trang trong cây: danh sách anh em + chỉ số, để đổi thứ tự bằng nút lên/xuống. */
interface Slot {
  siblings: WikiNode[];
  index: number;
  parentId: string | null;
}

function indexTree(
  nodes: WikiNode[],
  parentId: string | null,
  out: Map<string, Slot>,
): Map<string, Slot> {
  nodes.forEach((n, index) => {
    out.set(n.id, { siblings: nodes, index, parentId });
    if (n.children.length) indexTree(n.children, n.id, out);
  });
  return out;
}

const dateTime = fmtDateTime;

/**
 * Tài liệu nội bộ (wiki): cây trang bên trái, nội dung markdown bên phải.
 * Tạo trang / trang con bằng một cú bấm rồi sửa tại chỗ; đổi thứ tự bằng nút lên/xuống.
 */
export function WikiPage() {
  const confirm = useConfirm();
  const wsCanWrite = useAuth((s) => s.can('wiki:manage'));
  const wsCanDelete = useAuth((s) => s.can('project:admin'));
  const projectsQuery = useProjects();
  const projects = projectsQuery.data;

  // Phạm vi mặc định = dự án đang làm (để người viết vào là có nút ngay); người dùng chọn lại thì theo lựa chọn.
  const [scopeChoice, setScopeChoice] = useState<string | null>(null);
  const defaultScope = useMemo(() => {
    const key = currentProjectKey(projects);
    return (key && projects?.find((p) => p.key === key)?.id) || '';
  }, [projects]);
  // Chỉ chờ danh sách dự án khi nó còn đang tải (lỗi mạng thì vẫn tải cây ở phạm vi "Tất cả").
  const scopeReady = scopeChoice !== null || !projectsQuery.isPending;
  const scope = scopeChoice ?? defaultScope;
  const scopeProjectId = scope && scope !== WIKI_SCOPE_SHARED ? scope : null;
  const [q, setQ] = useState('');
  // Trang đang xem nằm trên URL (`?page=<id>`) để chia sẻ/quay lại được; `edit=1` = mở thẳng chế độ sửa.
  const [sp, setSp] = useSearchParams();
  const selectedId = sp.get('page');
  const wantEdit = sp.get('edit') === '1';
  const setSelectedId = useCallback(
    (id: string | null) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('page', id);
          else next.delete('page');
          next.delete('edit');
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeOpen, setTreeOpen] = useState(false);

  const searching = q.trim().length >= 2;
  const tree = useWikiTree(scope, scopeReady);
  const search = useWikiSearch(scope, q);
  const page = useWikiPage(selectedId);

  // Quyền theo TỪNG dự án: chỉ tra dự án của phạm vi đang xem + của trang đang mở (cache dùng chung với các màn khác);
  // dự án khác trong cây "Tất cả" tra lười khi rê/mở hàng (xem `TreeRow`). Sửa/tạo/đổi chỗ = wiki:manage, xoá = project:admin.
  // Dự án không còn trong danh sách đang hoạt động (đã lưu trữ) = không ghi được, không chờ.
  const activeIds = useMemo(() => new Set((projects ?? []).map((p) => p.id)), [projects]);
  const inactive = useCallback(
    (pid: string) => projects !== undefined && !activeIds.has(pid),
    [projects, activeIds],
  );
  const checkIds = useMemo(
    () => projectIdsToCheck(scopeProjectId, page.data?.projectId, inactive),
    [scopeProjectId, page.data?.projectId, inactive],
  );
  const projectCanWrite = useProjectsCan(checkIds, 'wiki:manage');
  const projectCanDelete = useProjectsCan(checkIds, 'project:admin');
  const writeCtx = { wsCan: wsCanWrite, projectCan: projectCanWrite, inactive };
  const deleteCtx = { wsCan: wsCanDelete, projectCan: projectCanDelete, inactive };
  const canWrite = (pid: string | null) => canWriteAt(pid, writeCtx);
  const canDelete = (pid: string | null) => canWriteAt(pid, deleteCtx);
  const pageWriteLoading = (pid: string | null) => writeLoadingAt(pid, writeCtx);
  const lazyOk = useCallback((pid: string) => !inactive(pid), [inactive]);
  const scopeWritable = canWrite(scopeProjectId);
  const scopeLoading = !scopeReady || pageWriteLoading(scopeProjectId);
  // Thùng rác: cùng quyền với xoá trang (project:admin ở phạm vi đang chọn; "Tất cả"/chung = quyền workspace).
  const scopeCanDelete = !scopeLoading && canDelete(scopeProjectId);

  const create = useCreateWikiPage();
  const update = useUpdateWikiPage();
  const move = useMoveWikiPage();
  const remove = useDeleteWikiPage();

  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Đang sửa mà trang lệch phiên bản (có người lưu trước) hoặc đã bị xoá → khối xử lý ngay trong ô sửa.
  const [editIssue, setEditIssue] = useState<'conflict' | 'deleted' | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  // `version` của trang lúc BẮT ĐẦU sửa (không lấy lại từ cache vì nền có thể tự làm mới giữa chừng).
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  // Nội dung lúc bắt đầu sửa: mốc để tính "có thay đổi chưa lưu".
  const [baseline, setBaseline] = useState<{ title: string; body: string } | null>(null);
  const loadedPage = page.data && page.data.id === selectedId ? page.data : undefined;
  const wikiDraft = useWikiDraft({
    editing,
    page: loadedPage,
    baseline,
    draftTitle,
    draftBody,
    baseVersion,
  });
  const { checkOffer } = wikiDraft;

  const slots = useMemo(
    () => indexTree(tree.data ?? [], null, new Map<string, Slot>()),
    [tree.data],
  );

  // Chọn sẵn trang đầu tiên để màn không bao giờ trống khi đã có dữ liệu.
  useEffect(() => {
    if (selectedId || !tree.data?.length) return;
    setSelectedId(tree.data[0]!.id);
  }, [tree.data, selectedId, setSelectedId]);

  // Vào thẳng một trang ở phạm vi khác phạm vi mặc định (vd từ khối "Tài liệu liên quan") → chuyển cây sang phạm vi đó.
  useEffect(() => {
    const pg = page.data;
    if (!pg || pg.id !== selectedId || scopeChoice !== null || !scopeReady) return;
    const pageScope = pg.projectId ?? WIKI_SCOPE_SHARED;
    if (scope !== '' && scope !== pageScope) setScopeChoice(pageScope);
  }, [page.data, selectedId, scopeChoice, scopeReady, scope]);

  // Trang đang chọn nằm sâu trong cây → mở sẵn các nhánh cha.
  useEffect(() => {
    if (!page.data?.breadcrumb.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const b of page.data.breadcrumb) next.add(b.id);
      return next;
    });
  }, [page.data]);

  useEffect(() => {
    if (editing) return;
    setDraftTitle(page.data?.title ?? '');
    setDraftBody(page.data?.body ?? '');
  }, [page.data, editing]);

  const scopeOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả tài liệu' },
      { value: WIKI_SCOPE_SHARED, label: 'Dùng chung cho mọi dự án' },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [projects],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopEditing() {
    setEditing(false);
    setEditIssue(null);
  }

  // Chỉ đặt state nên ổn định giữa các lần render (dùng được trong deps của effect `?edit=1`).
  const startEditing = useCallback(
    (pg: { id: string; title: string; body: string; version: number }) => {
      setDraftTitle(pg.title);
      setDraftBody(pg.body);
      setBaseVersion(pg.version);
      setBaseline({ title: pg.title, body: pg.body });
      setEditIssue(null);
      setEditing(true);
      checkOffer(pg);
    },
    [checkOffer],
  );

  // `?edit=1`: khi trang về và người xem có quyền viết thì vào chế độ sửa MỘT lần rồi xoá `edit` khỏi URL.
  const loaded = loadedPage;
  const loadedCanWrite = loaded ? canWrite(loaded.projectId) : false;
  const loadedWriteLoading = loaded ? pageWriteLoading(loaded.projectId) : true;
  useEffect(() => {
    if (!wantEdit || !loaded || editing || loadedWriteLoading) return;
    if (loadedCanWrite) startEditing(loaded);
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('edit');
        return next;
      },
      { replace: true },
    );
  }, [wantEdit, loaded, editing, loadedCanWrite, loadedWriteLoading, setSp, startEditing]);

  // Đang soạn dở thì hỏi "Bỏ thay đổi chưa lưu?" trước khi chuyển trang (cây, breadcrumb, kết quả tìm).
  async function openAfterConfirm(id: string) {
    if (id === selectedId) {
      setTreeOpen(false); // bấm lại đúng trang đang xem/đang sửa: không hỏi, không thoát chế độ sửa
      return;
    }
    if (!(await wikiDraft.confirmDiscard())) return;
    wikiDraft.runInternalNav(() => setSelectedId(id));
    stopEditing();
    setTreeOpen(false);
  }
  function open(id: string) {
    void openAfterConfirm(id);
  }

  /** Huỷ sửa (nút Huỷ / Esc trong ô soạn): có thay đổi thì hỏi, không có thì thoát luôn. */
  async function cancelEdit() {
    if (await wikiDraft.confirmDiscard()) stopEditing();
  }

  function restoreDraft(pg: { version: number }) {
    const o = wikiDraft.offer;
    if (!o) return;
    setDraftTitle(o.title);
    setDraftBody(o.body);
    setBaseVersion(o.baseVersion ?? pg.version);
    wikiDraft.setOffer(null);
  }

  /** Đổi phạm vi: bỏ chọn trang cũ (nó có thể thuộc phạm vi khác) trừ khi đang soạn dở. */
  function setScope(v: string) {
    setScopeChoice(v);
    if (!editing) setSelectedId(null);
  }

  /** Tạo trang mới (gốc ở phạm vi đang chọn) hoặc trang con (luôn cùng phạm vi với trang cha). */
  async function addPage(parent: { id: string; projectId: string | null } | null) {
    const parentId = parent?.id ?? null;
    if (!(await wikiDraft.confirmDiscard())) return;
    try {
      const created = await create.mutateAsync({
        title: parentId ? 'Trang con mới' : 'Trang mới',
        body: '',
        parentId,
        projectId: parent ? parent.projectId : scopeProjectId,
      });
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      wikiDraft.runInternalNav(() => setSelectedId(created.id));
      startEditing(created);
      setTreeOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function save(opts?: { overwrite?: boolean }) {
    if (!page.data) return;
    const title = draftTitle.trim();
    if (!title) {
      toast.error('Hãy nhập tiêu đề cho trang trước khi lưu');
      return;
    }
    try {
      let expectedVersion = baseVersion ?? page.data.version;
      // Ghi đè có xác nhận: lấy phiên bản mới nhất của máy chủ rồi lưu bản của tôi đè lên.
      if (opts?.overwrite)
        expectedVersion = (await page.refetch()).data?.version ?? expectedVersion;
      await update.mutateAsync({ id: page.data.id, title, body: draftBody, expectedVersion });
      wikiDraft.discard();
      stopEditing();
      toast.success('Đã lưu trang');
    } catch (e) {
      // Lỗi nào cũng giữ chế độ sửa để bản đang soạn không mất. `apiErrorMessage` luôn được gọi (đánh dấu đã báo)
      // để toast chung của MutationCache không chen thêm câu chung chung.
      const generic = apiErrorMessage(e);
      const code = apiErrorCode(e);
      if (code === 'VERSION_CONFLICT') setEditIssue('conflict');
      else if (code === 'NOT_FOUND') setEditIssue('deleted');
      else toast.error(generic);
    }
  }

  /** Tick một ô `- [ ]` ngay trên trang đọc: lưu có OCC (`version`); xung đột → tải lại bản mới để người dùng tick lại. */
  async function toggleTask(
    pg: Pick<WikiPageDetail, 'id' | 'body' | 'version'>,
    index: number,
    checked: boolean,
    itemText: string,
  ) {
    const next = setTaskChecked(pg.body, index, checked, itemText);
    if (next === null) {
      toast.error('Nội dung vừa thay đổi — hãy kiểm tra lại rồi tick lại.');
      return;
    }
    qc.setQueryData<WikiPageDetail>(keys.wiki.page(pg.id), (old) =>
      old ? { ...old, body: next } : old,
    );
    try {
      await update.mutateAsync({ id: pg.id, body: next, expectedVersion: pg.version });
    } catch (e) {
      void qc.invalidateQueries({ queryKey: keys.wiki.page(pg.id) });
      const generic = apiErrorMessage(e);
      toast.error(
        apiErrorCode(e) === 'VERSION_CONFLICT'
          ? 'Trang vừa được người khác sửa — đã tải bản mới, hãy tick lại.'
          : generic,
      );
    }
  }

  async function overwrite() {
    const ok = await confirm({
      title: 'Ghi đè bản mới của người khác bằng bản của bạn?',
      description:
        'Thay đổi người kia vừa lưu trên trang này sẽ bị thay bằng nội dung bạn đang soạn. Hãy xem bản mới trước nếu chưa chắc.',
      confirmLabel: 'Ghi đè',
      destructive: true,
    });
    if (ok) await save({ overwrite: true });
  }

  async function shift(id: string, delta: -1 | 1) {
    const slot = slots.get(id);
    if (!slot) return;
    const target = slot.index + delta;
    if (target < 0 || target >= slot.siblings.length) return;
    try {
      await move.mutateAsync({ id, parentId: slot.parentId, order: target });
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function destroy(id: string, title: string) {
    if (
      !(await confirm({
        title: `Xoá trang “${title}”?`,
        description:
          'Trang sẽ vào “Trang đã xoá”, quản trị khôi phục lại được. Các trang con không bị xoá theo, chúng sẽ được đưa lên cấp trên.',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(id);
      if (selectedId === id) setSelectedId(null);
      toast.success('Đã xoá trang');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const treePanel = (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm trong tài liệu…"
            aria-label="Tìm trong tài liệu"
            className="h-8 pl-8 text-sm"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Xoá từ khoá"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <SearchSelect
          value={scope}
          onChange={setScope}
          options={scopeOptions}
          ariaLabel="Phạm vi tài liệu"
          searchPlaceholder="Tìm dự án…"
          className="h-8 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {searching ? (
          <QueryBoundary
            query={search}
            skeleton={<TreeSkeleton />}
            empty={(d) => !d.length}
            emptyState={
              <EmptyState
                size="compact"
                icon={<SearchX />}
                title={`Không có trang nào khớp “${q.trim()}”`}
                description="Thử từ khoá ngắn hơn, hoặc đổi phạm vi sang “Tất cả tài liệu”."
              />
            }
          >
            {(hits) => (
              <ul className="space-y-0.5">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => open(hit.id)}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                        selectedId === hit.id && 'bg-surface-2',
                      )}
                    >
                      <span className="block truncate text-sm text-ink">{hit.title}</span>
                      {hit.snippet && (
                        <span className="mt-0.5 block truncate text-xs text-faint">
                          {hit.snippet}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </QueryBoundary>
        ) : (
          <QueryBoundary
            query={tree}
            skeleton={<TreeSkeleton />}
            empty={(d) => !d.length}
            emptyState={
              <EmptyState
                size="compact"
                icon={<FileText />}
                title="Chưa có trang nào ở phạm vi này"
                description={
                  scopeWritable
                    ? 'Bấm “Tạo trang mới” bên dưới để bắt đầu.'
                    : 'Hãy chọn phạm vi khác — hướng dẫn xin quyền viết ở ngay bên dưới.'
                }
              />
            }
          >
            {(nodes) => (
              <ul className="space-y-0.5">
                {nodes.map((node) => (
                  <TreeRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={selectedId}
                    expanded={expanded}
                    canWrite={canWrite}
                    lazyOk={lazyOk}
                    onOpen={open}
                    onToggle={toggle}
                    onAddChild={(n) => void addPage(n)}
                    onShift={(id, d) => void shift(id, d)}
                    slots={slots}
                  />
                ))}
              </ul>
            )}
          </QueryBoundary>
        )}
      </div>

      {scopeWritable ? (
        <div className="border-t border-border p-2">
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            loading={create.isPending}
            onClick={() => void addPage(null)}
          >
            <Plus className="h-4 w-4" /> Tạo trang mới
          </Button>
        </div>
      ) : (
        !scopeLoading && (
          <div className="border-t border-border p-3">
            <NoWriteNote scope={scope} />
          </div>
        )
      )}
      {scopeCanDelete && (
        <div className="border-t border-border p-2">
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-muted"
            title="Khôi phục trang đã xoá"
            onClick={() => setTrashOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> Trang đã xoá
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
          Wiki — tài liệu nội bộ
        </h1>
        <p className="mt-1 text-sm text-muted">
          Nơi lưu quy trình, hướng dẫn và biên bản họp. Viết bằng Markdown, xếp thành cây trang,
          dùng chung cho cả tổ chức hoặc riêng từng dự án.
        </p>
      </header>

      <div className="mb-3 lg:hidden">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen}
        >
          <PanelLeft className="h-4 w-4" />{' '}
          {treeOpen ? 'Ẩn danh sách trang' : 'Hiện danh sách trang'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside
          className={cn(
            'rounded-lg border border-border bg-surface lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)]',
            treeOpen ? 'block' : 'hidden lg:block',
          )}
        >
          {treePanel}
        </aside>

        <section className="min-w-0 rounded-lg border border-border bg-surface">
          {!selectedId ? (
            <div className="p-6">
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="Chưa chọn trang nào"
                description={
                  scopeWritable
                    ? 'Nội dung trang sẽ hiện ở đây. Chọn một trang ở danh sách bên trái, hoặc tạo trang mới để bắt đầu.'
                    : 'Nội dung trang sẽ hiện ở đây. Chọn một trang ở danh sách bên trái để đọc.'
                }
                action={
                  scopeWritable ? (
                    <Button size="sm" onClick={() => void addPage(null)}>
                      <Plus className="h-4 w-4" /> Tạo trang mới
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : page.isError && apiErrorCode(page.error) === 'NOT_FOUND' ? (
            <div className="p-6">
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="Trang không còn"
                description="Trang này đã bị xoá hoặc không tồn tại. Chọn một trang khác ở danh sách bên trái."
                action={
                  <Button size="sm" variant="secondary" onClick={() => setSelectedId(null)}>
                    Xem trang khác
                  </Button>
                }
              />
            </div>
          ) : (
            <QueryBoundary
              query={page}
              skeleton={
                <div className="space-y-3 p-6">
                  <Skeleton className="h-6 w-2/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              }
            >
              {(pg) => (
                <article className="p-6">
                  {pg.breadcrumb.length > 0 && (
                    <nav
                      aria-label="Đường dẫn trang"
                      className="mb-2 flex flex-wrap items-center gap-1 text-xs text-faint"
                    >
                      {pg.breadcrumb.map((b) => (
                        <span key={b.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => open(b.id)}
                            className="rounded transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                          >
                            {b.title}
                          </button>
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        </span>
                      ))}
                      <span className="text-muted">{pg.title}</span>
                    </nav>
                  )}

                  {editing ? (
                    <div className="space-y-3">
                      <Input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder="Tiêu đề trang"
                        aria-label="Tiêu đề trang"
                        autoFocus
                        className="h-10 text-lg font-semibold"
                      />
                      {wikiDraft.offer && (
                        <RestoreDraftBanner
                          offer={wikiDraft.offer}
                          pageVersion={pg.version}
                          onRestore={() => restoreDraft(pg)}
                          onDismiss={wikiDraft.discard}
                        />
                      )}
                      {editIssue && (
                        <EditIssueBanner
                          kind={editIssue}
                          latest={pg}
                          draftBody={draftBody}
                          busy={update.isPending}
                          onOverwrite={() => void overwrite()}
                          onClose={stopEditing}
                        />
                      )}
                      <MarkdownEditor
                        value={draftBody}
                        onChange={setDraftBody}
                        onSubmit={() => void save()}
                        onCancel={() => void cancelEdit()}
                        rows={18}
                        placeholder="Viết nội dung ở đây. Markdown cơ bản: # tiêu đề, **đậm**, - gạch đầu dòng… Gõ mã công việc (vd DEMO-STORY-3) để liên kết."
                      />
                      <div className="flex items-center gap-2">
                        <span
                          className="mr-auto text-xs text-faint"
                          title="Markdown là cách viết chữ đậm, tiêu đề, danh sách bằng ký hiệu — ví dụ **đậm** hoặc # Tiêu đề."
                        >
                          Markdown cơ bản · Gõ mã công việc (vd DEMO-STORY-3) để liên kết ·
                          Ctrl/⌘+Enter để lưu · Esc để huỷ
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Xem các phiên bản cũ của trang này"
                          onClick={() => setHistoryOpen(true)}
                        >
                          <History className="h-4 w-4" /> Lịch sử
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void cancelEdit()}>
                          Huỷ
                        </Button>
                        <Button
                          size="sm"
                          loading={update.isPending}
                          disabled={editIssue === 'deleted'}
                          onClick={() => void save()}
                        >
                          Lưu trang
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-xl font-semibold tracking-tight text-ink-strong">
                            {pg.title}
                          </h2>
                          <p className="mt-1 text-xs text-faint">
                            Sửa lần cuối {dateTime(pg.updatedAt)}
                            {pg.updatedBy ? ` · ${pg.updatedBy.displayName}` : ''}
                          </p>
                          {!canWrite(pg.projectId) && !pageWriteLoading(pg.projectId) && (
                            <ReadOnlyNote scope={pg.projectId ?? WIKI_SCOPE_SHARED} />
                          )}
                        </div>
                        <PageActions
                          title={pg.title}
                          canEdit={canWrite(pg.projectId)}
                          canDelete={canDelete(pg.projectId)}
                          onHistory={() => setHistoryOpen(true)}
                          onEdit={() => startEditing(pg)}
                          onAddChild={() => void addPage(pg)}
                          onDelete={() => void destroy(pg.id, pg.title)}
                        />
                      </div>

                      {pg.body.trim() ? (
                        <MarkdownView
                          text={pg.body}
                          issueRefs={Object.fromEntries(pg.issues.map((i) => [i.key, i]))}
                          onToggleTask={
                            canWrite(pg.projectId) && !update.isPending
                              ? (i, c, t) => void toggleTask(pg, i, c, t)
                              : undefined
                          }
                        />
                      ) : (
                        <EmptyState
                          size="compact"
                          icon={<FileText />}
                          title="Trang này chưa có nội dung"
                          description={
                            canWrite(pg.projectId) ? 'Bấm “Sửa trang” để bắt đầu viết.' : undefined
                          }
                        />
                      )}
                    </>
                  )}
                  <WikiHistoryDialog
                    key={pg.id}
                    open={historyOpen}
                    onOpenChange={setHistoryOpen}
                    page={pg}
                    canRestore={canWrite(pg.projectId)}
                    editing={editing}
                  />
                </article>
              )}
            </QueryBoundary>
          )}
        </section>
      </div>

      <WikiTrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        scope={scope}
        scopeLabel={(pid) =>
          pid ? (projects?.find((p) => p.id === pid)?.name ?? 'Dự án') : 'Dùng chung'
        }
        onRestored={open}
      />
    </div>
  );
}

/** Nhóm nút ở đầu trang (chế độ đọc): Lịch sử cho mọi người; Sửa / Thêm trang con / Xoá theo quyền. */
function PageActions({
  title,
  canEdit,
  canDelete,
  onHistory,
  onEdit,
  onAddChild,
  onDelete,
}: {
  title: string;
  canEdit: boolean;
  canDelete: boolean;
  onHistory: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        title="Xem các phiên bản cũ của trang này"
        onClick={onHistory}
      >
        <History className="h-4 w-4" /> Lịch sử
      </Button>
      {canEdit && (
        <>
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Sửa trang
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title="Tạo một trang nằm bên dưới trang này trong cây tài liệu."
            onClick={onAddChild}
          >
            <Plus className="h-4 w-4" /> Thêm trang con
          </Button>
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted hover:text-danger"
              title="Xoá trang"
              aria-label={`Xoá trang ${title}`}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="space-y-1.5 p-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selectedId,
  expanded,
  canWrite,
  lazyOk,
  onOpen,
  onToggle,
  onAddChild,
  onShift,
  slots,
}: {
  node: WikiNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  canWrite: (projectId: string | null) => boolean;
  /** Dự án còn hoạt động → được tra quyền lười khi rê/focus hàng (dự án lưu trữ thì không). */
  lazyOk: (projectId: string) => boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (node: WikiNode) => void;
  onShift: (id: string, delta: -1 | 1) => void;
  slots: Map<string, Slot>;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const slot = slots.get(node.id);
  const canUp = !!slot && slot.index > 0;
  const canDown = !!slot && slot.index < slot.siblings.length - 1;
  // Quyền của dự án KHÁC (cây "Tất cả") chỉ tra khi người dùng rê/focus hàng — không bắn N request lúc mở màn.
  const [armed, setArmed] = useState(false);
  const baseCan = canWrite(node.projectId);
  const lazyCan = useLazyProjectCan(
    node.projectId,
    'wiki:manage',
    armed && !baseCan && node.projectId !== null && lazyOk(node.projectId),
  );
  const showTools = baseCan || lazyCan;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-0.5 rounded-md pr-1 transition-colors hover:bg-surface-2',
          selectedId === node.id && 'bg-surface-2',
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
        onPointerEnter={() => setArmed(true)}
        onFocus={() => setArmed(true)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? `Thu gọn ${node.title}` : `Mở rộng ${node.title}`}
            aria-expanded={isOpen}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="grid h-6 w-6 shrink-0 place-items-center text-faint" aria-hidden>
            <FileText className="h-3.5 w-3.5" />
          </span>
        )}

        <button
          type="button"
          onClick={() => onOpen(node.id)}
          className={cn(
            'min-w-0 flex-1 truncate rounded px-1 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            selectedId === node.id ? 'font-medium text-ink-strong' : 'text-ink',
          )}
          title={node.title}
        >
          {node.title}
        </button>

        {showTools && (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              disabled={!canUp}
              onClick={() => onShift(node.id, -1)}
              aria-label={`Đưa ${node.title} lên trên`}
              title="Đổi chỗ với trang liền trên"
              className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:text-ink disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!canDown}
              onClick={() => onShift(node.id, 1)}
              aria-label={`Đưa ${node.title} xuống dưới`}
              title="Đổi chỗ với trang liền dưới"
              className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:text-ink disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onAddChild(node)}
              aria-label={`Thêm trang con cho ${node.title}`}
              title="Thêm một trang nằm bên dưới trang này"
              className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expanded={expanded}
              canWrite={canWrite}
              lazyOk={lazyOk}
              onOpen={onOpen}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onShift={onShift}
              slots={slots}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Câu hướng dẫn xin quyền (khối chân cây khi không có quyền viết ở phạm vi đang chọn). */
function NoWriteNote({ scope }: { scope: string }) {
  const admins = useWikiAdmins(scope, scope !== '');
  const names = (admins.data ?? []).map((a) => a.displayName);
  const noProject = !scope || scope === WIKI_SCOPE_SHARED;
  return (
    <div className="space-y-1 text-xs text-muted">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <Lock className="h-3.5 w-3.5 text-faint" aria-hidden /> Bạn chỉ đọc được ở phạm vi này
      </p>
      {noProject && <p>Chọn một dự án ở bộ lọc để viết tài liệu cho dự án đó.</p>}
      {scope !== '' && !admins.isPending && <p>{noWriteMessage(names)}</p>}
    </div>
  );
}

/** Dòng "Chỉ đọc" ở đầu trang wiki khi người xem không sửa được trang đó. */
function ReadOnlyNote({ scope }: { scope: string }) {
  const admins = useWikiAdmins(scope, true);
  const names = (admins.data ?? []).map((a) => a.displayName);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
      <Lock className="h-3 w-3 text-faint" aria-hidden />
      <span className="font-medium text-ink">Chỉ đọc</span>
      {!admins.isPending && <span>· {noWriteMessage(names)}</span>}
    </p>
  );
}

/**
 * Khối xử lý ngay trong ô sửa khi lưu thất bại vì có người lưu trước (conflict) hoặc trang đã bị xoá (deleted):
 * xem bản mới cạnh bản nháp, sao chép nội dung của tôi, hoặc ghi đè có xác nhận (chỉ khi conflict).
 */
function EditIssueBanner({
  kind,
  latest,
  draftBody,
  busy,
  onOverwrite,
  onClose,
}: {
  kind: 'conflict' | 'deleted';
  latest: { body: string; updatedAt: string; updatedBy: { displayName: string } | null };
  draftBody: string;
  busy: boolean;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const [showLatest, setShowLatest] = useState(false);

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(draftBody);
      toast.success('Đã sao chép nội dung của bạn');
    } catch {
      toast.error('Không sao chép được — hãy bôi đen nội dung trong ô rồi sao chép thủ công');
    }
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p className="font-medium text-ink-strong">
        {kind === 'conflict'
          ? 'Trang vừa được người khác sửa.'
          : 'Trang này đã bị xoá nên không lưu được.'}
      </p>
      <p className="text-muted">
        Bản bạn đang soạn vẫn còn trong ô bên dưới
        {kind === 'conflict' ? ' — chọn một cách xử lý:' : ' — hãy sao chép lại nếu cần.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'conflict' && (
          <Button size="sm" variant="secondary" onClick={() => setShowLatest((v) => !v)}>
            {showLatest ? 'Ẩn bản mới' : 'Xem bản mới'}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => void copyMine()}>
          Sao chép nội dung của tôi
        </Button>
        {kind === 'conflict' ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onOverwrite}>
            Ghi đè bằng bản của tôi
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        )}
      </div>
      {kind === 'conflict' && showLatest && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-3">
          <p className="mb-2 text-xs text-faint">
            Bản mới nhất · {dateTime(latest.updatedAt)}
            {latest.updatedBy ? ` · ${latest.updatedBy.displayName}` : ''}
          </p>
          {latest.body.trim() ? (
            <MarkdownView text={latest.body} />
          ) : (
            <p className="text-sm text-faint">Trang chưa có nội dung.</p>
          )}
        </div>
      )}
    </div>
  );
}
