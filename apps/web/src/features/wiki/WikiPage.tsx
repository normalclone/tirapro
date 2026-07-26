import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronRight, FileText, PanelLeft, Pencil, Plus,
  Search, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { MarkdownEditor, MarkdownView } from '@/features/issue-edit/DescriptionEditor';
import { useProjects } from '@/features/projects/api';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import {
  WIKI_SCOPE_SHARED, useCreateWikiPage, useDeleteWikiPage, useMoveWikiPage, useUpdateWikiPage,
  useWikiPage, useWikiSearch, useWikiTree, type WikiNode,
} from './api';

/** Vị trí của một trang trong cây: danh sách anh em + chỉ số, để đổi thứ tự bằng nút lên/xuống. */
interface Slot {
  siblings: WikiNode[];
  index: number;
  parentId: string | null;
}

function indexTree(nodes: WikiNode[], parentId: string | null, out: Map<string, Slot>): Map<string, Slot> {
  nodes.forEach((n, index) => {
    out.set(n.id, { siblings: nodes, index, parentId });
    if (n.children.length) indexTree(n.children, n.id, out);
  });
  return out;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Tài liệu nội bộ (wiki): cây trang bên trái, nội dung markdown bên phải.
 * Tạo trang / trang con bằng một cú bấm rồi sửa tại chỗ; đổi thứ tự bằng nút lên/xuống.
 */
export function WikiPage() {
  const canManage = useAuth((s) => s.can('wiki:manage'));
  const { data: projects } = useProjects();

  const [scope, setScope] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeOpen, setTreeOpen] = useState(false);

  const searching = q.trim().length >= 2;
  const tree = useWikiTree(scope);
  const search = useWikiSearch(scope, q);
  const page = useWikiPage(selectedId);

  const create = useCreateWikiPage();
  const update = useUpdateWikiPage();
  const move = useMoveWikiPage();
  const remove = useDeleteWikiPage();

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const slots = useMemo(() => indexTree(tree.data ?? [], null, new Map<string, Slot>()), [tree.data]);

  // Chọn sẵn trang đầu tiên để màn không bao giờ trống khi đã có dữ liệu.
  useEffect(() => {
    if (selectedId || !tree.data?.length) return;
    setSelectedId(tree.data[0]!.id);
  }, [tree.data, selectedId]);

  // Trang đang chọn nằm sâu trong cây → mở sẵn các nhánh cha.
  useEffect(() => {
    if (!page.data?.breadcrumb.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const b of page.data!.breadcrumb) next.add(b.id);
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

  function open(id: string) {
    setSelectedId(id);
    setEditing(false);
    setTreeOpen(false);
  }

  async function addPage(parentId: string | null) {
    try {
      const created = await create.mutateAsync({
        title: parentId ? 'Trang con mới' : 'Trang mới',
        body: '',
        parentId,
        projectId: parentId ? undefined : scope && scope !== WIKI_SCOPE_SHARED ? scope : null,
      });
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setSelectedId(created.id);
      setDraftTitle(created.title);
      setDraftBody(created.body);
      setEditing(true);
      setTreeOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function save() {
    if (!page.data) return;
    const title = draftTitle.trim();
    if (!title) {
      toast.error('Hãy nhập tiêu đề cho trang trước khi lưu');
      return;
    }
    try {
      await update.mutateAsync({ id: page.data.id, title, body: draftBody });
      setEditing(false);
      toast.success('Đã lưu trang');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
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
    if (!window.confirm(`Xoá trang “${title}”? Các trang con không bị xoá theo, chúng sẽ được đưa lên cấp trên.`)) return;
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
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
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
          search.isLoading ? (
            <TreeSkeleton />
          ) : !search.data?.length ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Không có trang nào khớp “{q.trim()}”. Thử từ khoá ngắn hơn, hoặc đổi phạm vi sang “Tất cả tài liệu”.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {search.data.map((hit) => (
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
                    {hit.snippet && <span className="mt-0.5 block truncate text-xs text-faint">{hit.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : tree.isLoading ? (
          <TreeSkeleton />
        ) : !tree.data?.length ? (
          <p className="px-2 py-6 text-center text-sm text-muted">
            Chưa có trang nào ở phạm vi này. {canManage ? 'Bấm “Tạo trang mới” bên dưới để bắt đầu.' : 'Hãy đổi phạm vi hoặc chờ người phụ trách thêm tài liệu.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tree.data.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                depth={0}
                selectedId={selectedId}
                expanded={expanded}
                canManage={canManage}
                onOpen={open}
                onToggle={toggle}
                onAddChild={(id) => void addPage(id)}
                onShift={(id, d) => void shift(id, d)}
                slots={slots}
              />
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="border-t border-border p-2">
          <Button size="sm" variant="secondary" className="w-full" loading={create.isPending} onClick={() => void addPage(null)}>
            <Plus className="h-4 w-4" /> Tạo trang mới
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Wiki — tài liệu nội bộ</h1>
        <p className="mt-1 text-sm text-muted">
          Nơi lưu quy trình, hướng dẫn và biên bản họp. Viết bằng Markdown, xếp thành cây trang, dùng chung cho cả tổ chức hoặc riêng từng dự án.
        </p>
      </header>

      <div className="mb-3 lg:hidden">
        <Button size="sm" variant="secondary" onClick={() => setTreeOpen((v) => !v)} aria-expanded={treeOpen}>
          <PanelLeft className="h-4 w-4" /> {treeOpen ? 'Ẩn danh sách trang' : 'Hiện danh sách trang'}
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
          {page.isLoading && selectedId ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : !page.data ? (
            <div className="p-6">
              <EmptyState
                icon={<BookOpen className="h-6 w-6" />}
                title="Chưa chọn trang nào"
                description={canManage ? 'Nội dung trang sẽ hiện ở đây. Chọn một trang ở danh sách bên trái, hoặc tạo trang mới để bắt đầu.' : 'Nội dung trang sẽ hiện ở đây. Chọn một trang ở danh sách bên trái để đọc.'}
                action={canManage ? <Button size="sm" onClick={() => void addPage(null)}><Plus className="h-4 w-4" /> Tạo trang mới</Button> : undefined}
              />
            </div>
          ) : (
            <article className="p-6">
              {page.data.breadcrumb.length > 0 && (
                <nav aria-label="Đường dẫn trang" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-faint">
                  {page.data.breadcrumb.map((b) => (
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
                  <span className="text-muted">{page.data.title}</span>
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
                  <MarkdownEditor
                    value={draftBody}
                    onChange={setDraftBody}
                    onSubmit={() => void save()}
                    onCancel={() => setEditing(false)}
                    rows={18}
                    placeholder="Viết nội dung ở đây. Hỗ trợ Markdown cơ bản: # tiêu đề, **đậm**, - gạch đầu dòng…"
                  />
                  <div className="flex items-center gap-2">
                    <span className="mr-auto text-xs text-faint" title="Markdown là cách viết chữ đậm, tiêu đề, danh sách bằng ký hiệu — ví dụ **đậm** hoặc # Tiêu đề.">
                      Hỗ trợ Markdown cơ bản · Ctrl/⌘+Enter để lưu · Esc để huỷ
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Huỷ</Button>
                    <Button size="sm" loading={update.isPending} onClick={() => void save()}>Lưu trang</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold tracking-tight text-ink-strong">{page.data.title}</h2>
                      <p className="mt-1 text-xs text-faint">
                        Sửa lần cuối {dateTime(page.data.updatedAt)}
                        {page.data.updatedBy ? ` · ${page.data.updatedBy.displayName}` : ''}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setDraftTitle(page.data!.title); setDraftBody(page.data!.body); setEditing(true); }}>
                          <Pencil className="h-4 w-4" /> Sửa trang
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          title="Tạo một trang nằm bên dưới trang này trong cây tài liệu."
                          onClick={() => void addPage(page.data!.id)}
                        >
                          <Plus className="h-4 w-4" /> Thêm trang con
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted hover:text-danger"
                          title="Xoá trang"
                          aria-label={`Xoá trang ${page.data.title}`}
                          onClick={() => void destroy(page.data!.id, page.data!.title)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {page.data.body.trim() ? (
                    <MarkdownView text={page.data.body} />
                  ) : (
                    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-faint">
                      Trang này chưa có nội dung.{canManage ? ' Bấm “Sửa trang” để bắt đầu viết.' : ''}
                    </p>
                  )}
                </>
              )}
            </article>
          )}
        </section>
      </div>
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
  node, depth, selectedId, expanded, canManage, onOpen, onToggle, onAddChild, onShift, slots,
}: {
  node: WikiNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  canManage: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
  onShift: (id: string, delta: -1 | 1) => void;
  slots: Map<string, Slot>;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const slot = slots.get(node.id);
  const canUp = !!slot && slot.index > 0;
  const canDown = !!slot && slot.index < slot.siblings.length - 1;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-0.5 rounded-md pr-1 transition-colors hover:bg-surface-2',
          selectedId === node.id && 'bg-surface-2',
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? `Thu gọn ${node.title}` : `Mở rộng ${node.title}`}
            aria-expanded={isOpen}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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

        {canManage && (
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
              onClick={() => onAddChild(node.id)}
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
              canManage={canManage}
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
