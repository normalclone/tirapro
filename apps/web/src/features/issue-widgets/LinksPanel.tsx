import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { StatusPill } from '@/components/ui/StatusPill';
import { useConfirm } from '@/components/ui/useConfirm';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCreateLink, useDeleteLink, useIssueLinks, useLinkTypes, type IssueLink } from './api';
import { IssueSearchBox } from './IssueSearchBox';
import { parseRelationValue, relationOptions } from './linkOptions';

/** `canEdit`: được sửa issue này — không thì chỉ xem (không nút thêm/xoá, tránh 403). */
export function LinksPanel({ issueId, canEdit }: { issueId: string; canEdit: boolean }) {
  const { data: links } = useIssueLinks(issueId);
  const deleteLink = useDeleteLink(issueId);
  const confirm = useConfirm();

  const [adding, setAdding] = useState(false);
  const count = links?.length ?? 0;
  const linkedIds = useMemo(() => new Set((links ?? []).map((l) => l.otherIssue.id)), [links]);

  async function onDelete(link: IssueLink) {
    if (!(await confirm({ title: `Xóa liên kết tới ${link.otherIssue.key}?`, destructive: true })))
      return;
    try {
      await deleteLink.mutateAsync(link.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const form = canEdit && adding && (
    <AddLinkForm issueId={issueId} linkedIds={linkedIds} onClose={() => setAdding(false)} />
  );

  // Trạng thái rỗng + chưa mở form: dòng nhạt + nút mở form.
  if (count === 0 && !(canEdit && adding)) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-muted">Liên kết</p>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Thêm liên kết
            </Button>
          )}
        </div>
        <p className="text-sm text-faint">Chưa có liên kết.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-muted">Liên kết ({count})</p>
        {canEdit && !adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm liên kết
          </Button>
        )}
        {canEdit && adding && (
          <Button variant="ghost" size="icon" onClick={() => setAdding(false)} aria-label="Đóng">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {(links ?? []).map((link) => (
          <div
            key={link.id}
            className="group flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            <Link2 className="h-4 w-4 shrink-0 text-muted" />
            <span className="shrink-0 text-xs text-muted">{link.relationName}</span>
            <Link
              to={`/issue/${link.otherIssue.key}`}
              className="shrink-0 rounded font-mono text-xs text-ink-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {link.otherIssue.key}
            </Link>
            <span className="min-w-0 flex-1 truncate text-ink">{link.otherIssue.summary}</span>
            <StatusPill
              status={link.otherIssue.status}
              className={cn(link.otherIssue.status.category === 'DONE' && 'opacity-70')}
            />
            {canEdit && (
              <button
                type="button"
                onClick={() => void onDelete(link)}
                disabled={deleteLink.isPending}
                aria-label={`Xóa liên kết tới ${link.otherIssue.key}`}
                className={cn(
                  'shrink-0 rounded p-1 text-faint transition-colors',
                  'hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {form && <div className="mt-2">{form}</div>}
    </div>
  );
}

/** Form "Thêm liên kết": chọn quan hệ (hai chiều) + tìm công việc đích theo mã/tiêu đề. */
function AddLinkForm({
  issueId,
  linkedIds,
  onClose,
}: {
  issueId: string;
  linkedIds: Set<string>;
  onClose: () => void;
}) {
  const { data: linkTypes } = useLinkTypes();
  const createLink = useCreateLink(issueId);
  const [relation, setRelation] = useState('');
  const [picked, setPicked] = useState<IssueDto | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const relations = useMemo(() => relationOptions(linkTypes ?? []), [linkTypes]);
  const effectiveRelation = relation || relations[0]?.value || '';

  // Chọn xong thì đưa focus sang nút Thêm: Enter lần hai là thêm luôn.
  useEffect(() => {
    if (picked) addBtnRef.current?.focus();
  }, [picked]);

  async function onAdd() {
    if (!picked) {
      toast.error('Tìm và chọn một công việc để liên kết');
      return;
    }
    const rel = parseRelationValue(effectiveRelation);
    if (!rel) {
      toast.error('Chọn quan hệ liên kết');
      return;
    }
    try {
      await createLink.mutateAsync({
        targetIssueId: picked.id,
        linkTypeId: rel.typeId,
        direction: rel.direction,
      });
      toast.success(`Đã liên kết với ${picked.key}`);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-2.5">
      <SearchSelect
        value={effectiveRelation}
        onChange={(v) => setRelation(v)}
        options={relations.map((r) => ({ value: r.value, label: r.label }))}
        ariaLabel="Quan hệ của công việc này với công việc được chọn"
        className="w-full"
      />
      {picked ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm">
          <IssueTypeIcon type={picked.type} />
          <span className="shrink-0 font-mono text-xs text-ink-strong">{picked.key}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{picked.summary}</span>
          <StatusPill status={picked.status} />
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Đổi
          </button>
        </div>
      ) : (
        <IssueSearchBox selfId={issueId} excludeIds={linkedIds} onSelect={setPicked} autoFocus />
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Huỷ
        </Button>
        <Button
          ref={addBtnRef}
          size="sm"
          disabled={!picked}
          loading={createLink.isPending}
          onClick={() => void onAdd()}
        >
          <Plus className="h-4 w-4" />
          Thêm
        </Button>
      </div>
    </div>
  );
}
