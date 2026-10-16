import { Button } from '@/components/ui/Button';
import { fmtDateTime } from '@/lib/dateFormat';
import type { WikiDraft } from './wikiDraft';

/** Đề nghị khôi phục bản nháp chưa lưu (tự lưu lần soạn trước) khi mở lại chế độ sửa. */
export function RestoreDraftBanner({
  offer,
  pageVersion,
  onRestore,
  onDismiss,
}: {
  offer: WikiDraft;
  pageVersion: number;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const stale = offer.baseVersion !== null && offer.baseVersion !== pageVersion;
  return (
    <div
      role="region"
      aria-label="Bản nháp chưa lưu"
      className="space-y-2 rounded-md border border-primary/30 bg-primary-subtle p-3 text-sm"
    >
      <p className="font-medium text-ink-strong">
        Có bản nháp chưa lưu từ{' '}
        {offer.savedAt ? fmtDateTime(new Date(offer.savedAt).toISOString()) : 'lần soạn trước'}.
      </p>
      {stale && (
        <p className="text-muted">
          Trang đã được sửa sau bản nháp này — khi lưu bạn sẽ được hỏi cách xử lý xung đột.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onRestore}>
          Khôi phục bản nháp
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Bỏ bản nháp
        </Button>
      </div>
    </div>
  );
}
