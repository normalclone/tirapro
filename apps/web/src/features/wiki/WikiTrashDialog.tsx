import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { Skeleton } from '@/components/ui/primitives';
import { apiErrorMessage } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/dateFormat';
import { useUndeleteWikiPage, useWikiTrash } from './api';

/**
 * "Trang đã xoá" của phạm vi đang chọn (chỉ người có `project:admin` ở phạm vi đó mở được): khôi phục một trang
 * kèm toàn bộ lịch sử phiên bản. Trang con đã được nâng lên lúc xoá thì không tự trở lại.
 */
export function WikiTrashDialog({
  open,
  onOpenChange,
  scope,
  scopeLabel,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: string;
  /** Nhãn phạm vi của một trang (tên dự án / "Dùng chung") — chỉ hiện khi đang xem "Tất cả tài liệu". */
  scopeLabel: (projectId: string | null) => string;
  onRestored: (pageId: string) => void;
}) {
  const trash = useWikiTrash(scope, open);
  const undelete = useUndeleteWikiPage();

  async function restore(id: string, title: string) {
    try {
      const page = await undelete.mutateAsync(id);
      toast.success(`Đã khôi phục trang “${title}”`);
      onOpenChange(false);
      onRestored(page.id);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Trang đã xoá"
      description="Khôi phục lại trang kèm toàn bộ lịch sử phiên bản. Các trang con đã được đưa lên cấp trên lúc xoá sẽ ở nguyên chỗ mới."
      icon={<Trash2 className="h-4 w-4" />}
      size="lg"
    >
      <QueryBoundary
        query={trash}
        skeleton={
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        empty={(d) => d.length === 0}
        emptyState={
          <p className="py-6 text-center text-sm text-muted">Chưa có trang nào bị xoá.</p>
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                  <p className="truncate text-xs text-muted" title={fmtDateTime(r.deletedAt)}>
                    {scope === '' ? `${scopeLabel(r.projectId)} · ` : ''}
                    Xoá {fmtRelative(r.deletedAt)}
                    {r.deletedByName ? ` · bởi ${r.deletedByName}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={undelete.isPending && undelete.variables === r.id}
                  disabled={undelete.isPending}
                  onClick={() => void restore(r.id, r.title)}
                  aria-label={`Khôi phục trang ${r.title}`}
                >
                  <RotateCcw className="h-4 w-4" /> Khôi phục
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Dialog>
  );
}
