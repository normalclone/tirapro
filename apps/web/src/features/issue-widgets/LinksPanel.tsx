import { useState } from 'react';
import { Link2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  useCreateLink,
  useDeleteLink,
  useIssueLinks,
  useLinkTypes,
  type IssueLink,
} from './api';

export function LinksPanel({ issueId }: { issueId: string }) {
  const { data: links } = useIssueLinks(issueId);
  const { data: linkTypes } = useLinkTypes();
  const createLink = useCreateLink(issueId);
  const deleteLink = useDeleteLink(issueId);

  const [adding, setAdding] = useState(false);
  const [linkTypeId, setLinkTypeId] = useState('');
  const [targetKey, setTargetKey] = useState('');

  const count = links?.length ?? 0;
  const effectiveLinkTypeId = linkTypeId || linkTypes?.[0]?.id || '';

  async function onAdd() {
    const key = targetKey.trim().toUpperCase();
    if (!key) {
      toast.error('Nhập mã vấn đề (vd: DEMO-2)');
      return;
    }
    if (!effectiveLinkTypeId) {
      toast.error('Chọn loại liên kết');
      return;
    }
    let targetIssueId: string;
    try {
      targetIssueId = (await api.get<{ id: string }>(`/issues/${key}`)).data.id;
    } catch {
      toast.error(`Không tìm thấy vấn đề "${key}"`);
      return;
    }
    try {
      await createLink.mutateAsync({ targetIssueId, linkTypeId: effectiveLinkTypeId });
      setTargetKey('');
      setAdding(false);
      toast.success('Đã thêm liên kết');
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  async function onDelete(link: IssueLink) {
    if (!window.confirm(`Xóa liên kết tới ${link.otherIssue.key}?`)) return;
    try {
      await deleteLink.mutateAsync(link.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  const form = adding && (
    <div className="space-y-2 rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <SearchSelect
          value={effectiveLinkTypeId}
          onChange={(v) => setLinkTypeId(v)}
          options={(linkTypes ?? []).map((t) => ({ value: t.id, label: t.outwardName }))}
          ariaLabel="Loại liên kết"
          className="w-36 shrink-0"
        />
        <Input
          placeholder="Mã vấn đề (vd: DEMO-2)"
          value={targetKey}
          onChange={(e) => setTargetKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onAdd();
            }
          }}
          className="font-mono"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdding(false);
            setTargetKey('');
          }}
        >
          Hủy
        </Button>
        <Button size="sm" loading={createLink.isPending} onClick={() => void onAdd()}>
          <Plus className="h-4 w-4" />
          Thêm
        </Button>
      </div>
    </div>
  );

  // Trạng thái rỗng + chưa mở form: dòng nhạt + nút mở form.
  if (count === 0 && !adding) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-muted">Liên kết</p>
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm liên kết
          </Button>
        </div>
        <p className="text-sm text-faint">Chưa có liên kết.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-muted">Liên kết ({count})</p>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Thêm liên kết
          </Button>
        )}
        {adding && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setAdding(false);
              setTargetKey('');
            }}
            aria-label="Đóng"
          >
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
            <span className="shrink-0 font-mono text-xs text-ink-strong">{link.otherIssue.key}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{link.otherIssue.summary}</span>
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
          </div>
        ))}
      </div>

      {form && <div className="mt-2">{form}</div>}
    </div>
  );
}
