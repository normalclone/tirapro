import { useMemo, useState } from 'react';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/useConfirm';
import { MarkdownView } from '@/features/issue-edit/MarkdownView';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/dateFormat';
import { cn } from '@/lib/utils';
import {
  useRestoreWikiVersion,
  useWikiVersion,
  useWikiVersions,
  type WikiPageDetail,
  type WikiVersion,
  type WikiVersionSummary,
} from './api';
import { collapseSame, diffLines } from './lineDiff';

type Tab = 'content' | 'diff';

/**
 * Lịch sử phiên bản của một trang wiki: danh sách bên trái, xem bản cũ / so với bản hiện tại bên phải,
 * khôi phục (người có quyền viết, có xác nhận, chống ghi đè theo `page.version`). Dưới `md` danh sách và chi tiết
 * xếp thay nhau (chọn bản → sang chi tiết, có nút quay lại).
 */
export function WikiHistoryDialog({
  open,
  onOpenChange,
  page,
  canRestore,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: WikiPageDetail;
  canRestore: boolean;
  /** Đang soạn dở trang này → khoá nút Khôi phục để không mất bản nháp. */
  editing: boolean;
}) {
  const versions = useWikiVersions(page.id, open);
  const [picked, setPicked] = useState<number | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const list = versions.data;
  // Mặc định chọn bản liền trước bản hiện tại (bản đầu danh sách là "Hiện tại") — thứ người ta thường muốn xem.
  const selected = picked ?? (list ? (list[1] ?? list[0])?.version : undefined) ?? null;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setPicked(null);
      setMobileDetail(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Lịch sử — ${page.title}`}
      icon={<History className="h-4 w-4" />}
      size="xl"
      className="md:h-[34rem]"
      bodyClassName="p-0"
    >
      <QueryBoundary
        query={versions}
        skeleton={
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <div className="p-6">
            <EmptyState
              size="compact"
              icon={<History />}
              title="Trang này chưa có phiên bản nào"
              description="Lần lưu tiếp theo sẽ được ghi lại."
            />
          </div>
        }
      >
        {(rows) => (
          <div className="grid h-full min-h-[24rem] grid-cols-1 md:grid-cols-[17rem_minmax(0,1fr)]">
            <div
              className={cn(
                'overflow-y-auto border-border md:border-r',
                mobileDetail ? 'hidden md:block' : 'block',
              )}
            >
              <VersionList
                rows={rows}
                selected={selected}
                onPick={(v) => {
                  setPicked(v);
                  setMobileDetail(true);
                }}
              />
            </div>
            <div
              className={cn('min-w-0 overflow-y-auto', mobileDetail ? 'block' : 'hidden md:block')}
            >
              {selected !== null && (
                <VersionDetail
                  key={selected}
                  page={page}
                  version={selected}
                  isLatest={rows[0]?.version === selected}
                  canRestore={canRestore}
                  editing={editing}
                  onBack={() => setMobileDetail(false)}
                  onRestored={() => close(false)}
                />
              )}
            </div>
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  );
}

function VersionList({
  rows,
  selected,
  onPick,
}: {
  rows: WikiVersionSummary[];
  selected: number | null;
  onPick: (version: number) => void;
}) {
  const latest = rows[0]?.version;
  return (
    <ul aria-label="Các phiên bản" className="p-2">
      {rows.map((r) => (
        <li key={r.version}>
          <button
            type="button"
            aria-current={selected === r.version ? 'true' : undefined}
            onClick={() => onPick(r.version)}
            className={cn(
              'w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
              selected === r.version && 'bg-surface-2',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              Phiên bản {r.version}
              {r.version === latest && (
                <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  Hiện tại
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink" title={r.title}>
              {r.title}
            </span>
            <span
              className="mt-0.5 block truncate text-xs text-muted"
              title={fmtDateTime(r.createdAt)}
            >
              {r.authorName ?? 'Người dùng đã xoá'} · {fmtRelative(r.createdAt)}
            </span>
            {r.note && <span className="mt-0.5 block truncate text-xs text-faint">{r.note}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function VersionDetail({
  page,
  version,
  isLatest,
  canRestore,
  editing,
  onBack,
  onRestored,
}: {
  page: WikiPageDetail;
  version: number;
  isLatest: boolean;
  canRestore: boolean;
  editing: boolean;
  onBack: () => void;
  onRestored: () => void;
}) {
  const confirm = useConfirm();
  const restore = useRestoreWikiVersion();
  const query = useWikiVersion(page.id, version);
  const [tab, setTab] = useState<Tab>('content');

  async function onRestore() {
    const ok = await confirm({
      title: `Khôi phục phiên bản ${version}? Nội dung hiện tại được lưu thành phiên bản mới, không mất.`,
      confirmLabel: 'Khôi phục',
    });
    if (!ok) return;
    try {
      await restore.mutateAsync({ id: page.id, version, expectedVersion: page.version });
      toast.success(`Đã khôi phục phiên bản ${version}`);
      onRestored();
    } catch (e) {
      const generic = apiErrorMessage(e);
      if (apiErrorCode(e) === 'VERSION_CONFLICT') {
        toast.error('Trang vừa được người khác sửa, hãy mở lại Lịch sử');
        onRestored();
      } else toast.error(generic);
    }
  }

  const showRestore = canRestore && !isLatest;

  return (
    <div className="p-4">
      <Button size="sm" variant="ghost" className="mb-2 md:hidden" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách
      </Button>
      <QueryBoundary
        query={query}
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        }
      >
        {(v) => (
          <>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-ink-strong">{v.title}</h3>
                <p className="mt-0.5 text-xs text-faint">
                  Phiên bản {v.version} · {v.authorName ?? 'Người dùng đã xoá'} ·{' '}
                  {fmtDateTime(v.createdAt)}
                  {v.note ? ` · ${v.note}` : ''}
                </p>
              </div>
              {showRestore && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={editing}
                    loading={restore.isPending}
                    onClick={() => void onRestore()}
                  >
                    <RotateCcw className="h-4 w-4" /> Khôi phục phiên bản này
                  </Button>
                  {editing && (
                    <span className="text-xs text-muted">Lưu hoặc huỷ bản đang soạn trước</span>
                  )}
                </div>
              )}
            </div>
            <Tabs
              idBase="wiki-ver"
              ariaLabel="Cách xem phiên bản"
              value={tab}
              onChange={setTab}
              items={VIEW_TABS.map(([id, label]) => ({ id, label }))}
              className="mb-3"
            />
            <TabPanel
              idBase="wiki-ver"
              value={tab}
              tabIndex={0}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {tab === 'content' ? (
                <VersionBody version={v} />
              ) : (
                <VersionDiff from={v} page={page} />
              )}
            </TabPanel>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

const VIEW_TABS = [
  ['content', 'Nội dung'],
  ['diff', 'So với bản hiện tại'],
] as const;

function VersionBody({ version }: { version: WikiVersion }) {
  return version.body.trim() ? (
    <MarkdownView text={version.body} />
  ) : (
    <p className="text-sm text-faint">Phiên bản này chưa có nội dung.</p>
  );
}

/** Khác biệt `bản cũ → bản hiện tại`: `+` = phần mới thêm sau bản cũ, `−` = phần đã bị bỏ. */
function VersionDiff({
  from,
  page,
}: {
  from: WikiVersion;
  page: Pick<WikiPageDetail, 'title' | 'body'>;
}) {
  const rows = useMemo(() => {
    const d = diffLines(from.body, page.body);
    return d && collapseSame(d);
  }, [from.body, page.body]);
  const titleChanged = from.title !== page.title;
  const changed = rows?.some((r) => r.type === 'add' || r.type === 'del') ?? false;

  if (rows === null)
    return (
      <p className="text-sm text-muted">Trang quá dài để so sánh — hãy xem ở tab “Nội dung”.</p>
    );
  return (
    <div className="space-y-2">
      {titleChanged && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink">
          Tiêu đề: <del className="text-muted">{from.title}</del> → <strong>{page.title}</strong>
        </p>
      )}
      {!changed && !titleChanged && (
        <p className="text-sm text-muted">Phiên bản này giống bản hiện tại.</p>
      )}
      {changed && (
        <div className="overflow-x-auto rounded-md border border-border font-mono text-xs leading-relaxed">
          {rows.map((r, i) =>
            r.type === 'skip' ? (
              <div key={i} className="bg-surface-2 px-3 py-1 text-faint">
                … {r.count} dòng không đổi
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  'flex gap-2 px-3 py-0.5',
                  r.type === 'add' && 'bg-success/10 text-ink',
                  r.type === 'del' && 'bg-danger/10 text-ink',
                  r.type === 'same' && 'text-muted',
                )}
              >
                <span aria-hidden className="w-3 shrink-0 select-none">
                  {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
                </span>
                <span className="sr-only">
                  {r.type === 'add' ? 'Thêm: ' : r.type === 'del' ? 'Bỏ: ' : ''}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{r.text || ' '}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
