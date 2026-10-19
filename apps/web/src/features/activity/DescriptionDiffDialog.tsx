import { useMemo } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { DelayedSpinner } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { fmtRelative } from '@/lib/dateFormat';
import { collapseSame, diffLines } from '@/lib/textDiff';
import { cn } from '@/lib/utils';
import { useActivityDetail, type ActivityItem } from './api';

/**
 * Hộp so sánh mô tả cũ/mới của một dòng lịch sử `DESCRIPTION`. Luôn mount với `open` thật (giữ hiệu ứng đóng): cha giữ
 * `item` gần nhất bằng `useRetained`. Bản đầy đủ chỉ tải khi mở (danh sách chỉ mang bản xem trước ≤ 200 ký tự).
 * Không chỉ dựa vào màu: dòng thêm có dấu `+` và chữ ẩn "Thêm", dòng xoá có `−` và "Xoá".
 */
export function DescriptionDiffDialog({
  open,
  issueId,
  item,
  onClose,
}: {
  open: boolean;
  issueId: string;
  item: ActivityItem;
  onClose: () => void;
}) {
  const detail = useActivityDetail(issueId, item.id, open);
  const d = detail.data;
  const rows = useMemo(
    () => (d ? collapseSame(diffLines(d.oldValue ?? '', d.newValue ?? '')) : []),
    [d],
  );
  const changed = rows.some((r) => r.op === 'add' || r.op === 'del');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Thay đổi mô tả"
      description={`${item.actor?.displayName ?? 'Hệ thống'} · ${fmtRelative(item.occurredAt)}`}
      size="xl"
    >
      {detail.isError ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !d ? (
        <DelayedSpinner />
      ) : !changed ? (
        <p className="text-sm text-muted">Nội dung mô tả không đổi.</p>
      ) : (
        <div
          role="group"
          aria-label="So sánh mô tả cũ và mới"
          className="overflow-hidden rounded-md border border-border"
        >
          {rows.map((r, i) =>
            r.op === 'skip' ? (
              <div key={i} className="bg-surface-2 px-3 py-1 text-center text-xs text-faint">
                … {r.count} dòng không đổi …
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  'flex gap-2 px-3 py-0.5 font-mono text-xs',
                  r.op === 'add' && 'bg-status-done/10 text-ink',
                  r.op === 'del' && 'bg-danger/10 text-ink',
                  r.op === 'same' && 'text-muted',
                )}
              >
                <span aria-hidden className="w-3 shrink-0 select-none text-center">
                  {r.op === 'add' ? '+' : r.op === 'del' ? '−' : ' '}
                </span>
                {r.op !== 'same' && (
                  <span className="sr-only">{r.op === 'add' ? 'Thêm' : 'Xoá'}</span>
                )}
                <span className="min-w-0 whitespace-pre-wrap break-words">{r.text || ' '}</span>
              </div>
            ),
          )}
        </div>
      )}
    </Dialog>
  );
}
