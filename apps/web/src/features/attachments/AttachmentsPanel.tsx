import { useRef, useState } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Lightbox } from '@/components/ui/Lightbox';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  downloadAttachment,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
  type Attachment,
} from './api';
import { AttachmentPicture } from './AttachmentImage';
import { isImageMime } from './ref';

/** Định dạng byte → "x B" / "x KB" / "x.x MB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `canEdit`: được sửa issue này — không thì chỉ xem/tải xuống (không nút tải lên/xoá, tránh 403). */
export function AttachmentsPanel({ issueId, canEdit }: { issueId: string; canEdit: boolean }) {
  const { data: attachments } = useAttachments(issueId);
  const upload = useUploadAttachment(issueId);
  const remove = useDeleteAttachment(issueId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const items = attachments ?? [];
  // Mọi ảnh của issue, theo thứ tự hiện trong danh sách: ←/→ trong lightbox đi qua đúng các ảnh này.
  const images = items.filter((a) => isImageMime(a.mimeType));

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng file
    if (!file) return;
    try {
      await upload.mutateAsync(file);
      toast.success('Đã tải lên tệp');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function onDownload(a: Attachment) {
    setDownloadingId(a.id);
    try {
      await downloadAttachment(a.id, a.fileName);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  }

  async function onDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      setConfirmId(null);
      toast.success('Đã xoá tệp');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-muted">
          Tệp đính kèm{items.length ? ` (${items.length})` : ''}
        </p>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              onChange={onPick}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={upload.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {!upload.isPending && <Upload className="h-4 w-4" />}
              Tải lên
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-faint">Chưa có tệp.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => {
            const confirming = canEdit && confirmId === a.id;
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-sm"
              >
                {isImageMime(a.mimeType) ? (
                  <button
                    type="button"
                    onClick={() => setViewing(images.findIndex((i) => i.id === a.id))}
                    aria-label={`Xem ảnh ${a.fileName}`}
                    className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded border border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <AttachmentPicture
                      id={a.id}
                      alt={a.fileName}
                      className="h-full w-full object-cover"
                      placeholderClassName="h-full w-full rounded-none"
                    />
                  </button>
                ) : (
                  <Paperclip className="h-4 w-4 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-ink" title={a.fileName}>
                  {a.fileName}
                </span>
                <span className="shrink-0 tabular text-xs text-faint">
                  {formatBytes(a.sizeBytes)}
                </span>

                {confirming ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="danger"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      loading={remove.isPending}
                      onClick={() => void onDelete(a.id)}
                    >
                      Xoá
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setConfirmId(null)}
                    >
                      Huỷ
                    </Button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn('h-7 w-7')}
                      loading={downloadingId === a.id}
                      onClick={() => void onDownload(a)}
                      aria-label={`Tải xuống ${a.fileName}`}
                    >
                      {downloadingId !== a.id && <Download className="h-4 w-4 text-muted" />}
                    </Button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setConfirmId(a.id)}
                        aria-label={`Xoá ${a.fileName}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted" />
                      </Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Lightbox
        open={viewing !== null}
        onOpenChange={(o) => !o && setViewing(null)}
        items={images.map((a) => ({ id: a.id, name: a.fileName }))}
        index={Math.max(viewing ?? 0, 0)}
        onIndexChange={setViewing}
        renderImage={(it) => (
          <AttachmentPicture
            id={it.id}
            alt={it.name}
            className="max-h-[70dvh] max-w-full rounded-md object-contain"
          />
        )}
        onDownload={(it) => void onDownload(items.find((a) => a.id === it.id)!)}
      />
    </div>
  );
}
