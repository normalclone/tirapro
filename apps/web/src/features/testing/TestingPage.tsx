import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ClipboardList, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { pageContainer } from '@/components/layout/page';
import { useProject } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { LinkIssuesModal, TestCaseEditorModal } from './TestCaseEditorModal';
import { TestRunsPanel } from './TestRunsPanel';
import { useDebounced, useDeleteTestCase, useTestCases, useTestFolders, type TestCaseDto } from './api';

type Tab = 'cases' | 'runs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'cases', label: 'Ca kiểm thử' },
  { id: 'runs', label: 'Đợt chạy' },
];

/** Trang Quản lý kiểm thử của một dự án: ca kiểm thử (test case) & đợt chạy (test run). */
export function TestingPage() {
  const { key = '' } = useParams();
  const { data: project, isLoading: projectLoading } = useProject(key);
  const projectId = project?.id;
  const canManage = useAuth((s) => s.can('test:manage'));
  const [tab, setTab] = useState<Tab>('cases');

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Quản lý kiểm thử</h1>
        <p className="mt-1 text-sm text-muted">
          Viết ca kiểm thử, liên kết chúng với issue để truy vết, rồi gom vào đợt chạy để ghi kết quả và tạo bug khi không đạt.
        </p>
      </header>

      <div className="mb-6 flex gap-1 border-b border-border" role="tablist" aria-label="Quản lý kiểm thử">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              tab === t.id ? 'border-primary text-ink-strong' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {projectLoading || !projectId ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : tab === 'cases' ? (
        <TestCasesPanel projectId={projectId} canManage={canManage} />
      ) : (
        <TestRunsPanel projectId={projectId} canManage={canManage} />
      )}
    </div>
  );
}

function TestCasesPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [folder, setFolder] = useState('');
  const { data: cases, isLoading, isFetching, isError, error, refetch } = useTestCases(projectId, search, folder);
  const { data: folders } = useTestFolders(projectId);
  const remove = useDeleteTestCase(projectId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeCase = useMemo(() => (cases ?? []).find((c) => c.id === activeId) ?? null, [cases, activeId]);
  const folderOptions = useMemo(
    () => [{ value: '', label: 'Tất cả thư mục' }, ...(folders ?? []).map((f) => ({ value: f, label: f }))],
    [folders],
  );

  function openCreate() {
    setActiveId(null);
    setEditorOpen(true);
  }

  function openEdit(c: TestCaseDto) {
    setActiveId(c.id);
    setEditorOpen(true);
  }

  function openLinks(c: TestCaseDto) {
    setActiveId(c.id);
    setLinkOpen(true);
  }

  async function handleRemove(c: TestCaseDto) {
    if (!window.confirm(`Xóa ca kiểm thử ${c.key} — ${c.title}?`)) return;
    try {
      await remove.mutateAsync(c.id);
      toast.success(`Đã xóa ${c.key}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const filtering = !!search || !!folder;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo mã, tiêu đề hoặc các bước…"
            aria-label="Tìm ca kiểm thử"
            className="pl-8"
          />
        </div>
        <SearchSelect
          value={folder}
          onChange={setFolder}
          options={folderOptions}
          placeholder="Tất cả thư mục"
          searchPlaceholder="Tìm thư mục…"
          ariaLabel="Lọc theo thư mục"
          className="min-w-[10rem]"
        />
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Tạo ca kiểm thử
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !cases || cases.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={filtering ? 'Không có ca kiểm thử phù hợp' : 'Chưa có ca kiểm thử nào'}
          description={
            filtering
              ? 'Thử đổi từ khóa hoặc bỏ lọc thư mục.'
              : 'Ca kiểm thử mô tả các bước cần làm và kết quả mong đợi — cơ sở để chạy và ghi kết quả sau này.'
          }
          action={
            filtering
              ? <Button size="sm" variant="secondary" onClick={() => { setQ(''); setFolder(''); }}>Xóa bộ lọc</Button>
              : canManage
                ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Tạo ca kiểm thử</Button>
                : undefined
          }
        />
      ) : (
        <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface transition-opacity', isFetching && 'opacity-70')}>
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">Danh sách ca kiểm thử của dự án</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th scope="col" className="px-4 py-2.5">Mã</th>
                <th scope="col" className="px-4 py-2.5">Tiêu đề</th>
                <th scope="col" className="px-4 py-2.5">Thư mục</th>
                <th scope="col" className="px-4 py-2.5">Chủ sở hữu</th>
                <th scope="col" className="px-4 py-2.5">Issue</th>
                <th scope="col" className="px-4 py-2.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cases.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{c.key}</td>
                  <td className="px-4 py-2.5">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="rounded text-left font-medium text-ink transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        {c.title}
                      </button>
                    ) : (
                      <span className="font-medium text-ink">{c.title}</span>
                    )}
                    {c.expected && <p className="mt-0.5 line-clamp-1 text-xs text-faint">Mong đợi: {c.expected}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.folder ?? <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-2.5">
                    {c.owner ? (
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <Avatar name={c.owner.displayName} src={c.owner.avatarUrl} size={20} />
                        <span className="truncate">{c.owner.displayName}</span>
                      </span>
                    ) : (
                      <span className="text-faint">Chưa gán</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openLinks(c)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        aria-label={`Sửa issue liên kết của ${c.key}`}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden /> {c.issueCount}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                        <Link2 className="h-3.5 w-3.5" aria-hidden /> {c.issueCount}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {canManage && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Sửa ca kiểm thử" aria-label={`Sửa ${c.key}`} onClick={() => openEdit(c)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted hover:text-danger"
                            title="Xóa ca kiểm thử"
                            aria-label={`Xóa ${c.key}`}
                            onClick={() => void handleRemove(c)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TestCaseEditorModal
        open={editorOpen}
        projectId={projectId}
        testCase={activeCase}
        folders={folders ?? []}
        onClose={() => setEditorOpen(false)}
      />
      <LinkIssuesModal
        open={linkOpen}
        projectId={projectId}
        testCase={activeCase}
        onClose={() => setLinkOpen(false)}
      />
    </section>
  );
}
