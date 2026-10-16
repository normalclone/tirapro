import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import { Lightbox } from '@/components/ui/Lightbox';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { downloadAttachment, useAttachmentUrl, type Attachment } from './api';

/**
 * Ảnh đính kèm (blob có token) với khung giữ chỗ chống nhảy layout và khung lỗi "Không xem được ảnh".
 * Blob URL bị đẩy khỏi bộ nhớ đệm (quá 60 ảnh) thì `onError` nạp lại đúng một lần.
 */
function AttachmentPicture({
  id,
  alt,
  className,
  placeholderClassName,
}: {
  id: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}) {
  const { data: url, isError, isPending, refetch } = useAttachmentUrl(id);
  const retried = useRef(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    retried.current = false;
    setBroken(false);
  }, [id]);

  if (isError || broken) {
    return (
      <span
        role="img"
        aria-label={`Không xem được ảnh ${alt}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted',
          placeholderClassName,
        )}
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">Không xem được ảnh{alt ? ` — ${alt}` : ''}</span>
      </span>
    );
  }
  if (isPending || !url) {
    return (
      <span
        aria-hidden
        className={cn(
          'block h-32 w-48 animate-pulse rounded-md bg-surface-2',
          placeholderClassName,
        )}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onLoad={() => {
        retried.current = false; // tải được rồi thì lần revoke sau vẫn nạp lại được
      }}
      onError={() => {
        if (retried.current) return setBroken(true);
        retried.current = true;
        void refetch();
      }}
    />
  );
}

/** Ảnh nhúng trong Markdown (`![tên](attachment:ID)`): bấm để phóng to. */
export function AttachmentImage({ id, alt }: { id: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const name = alt || 'Ảnh đính kèm';
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Xem ảnh ${name}`}
        className="my-2 block max-w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <AttachmentPicture
          id={id}
          alt={name}
          className="block max-h-96 max-w-full rounded-md border border-border"
        />
      </button>
      <Lightbox
        open={open}
        onOpenChange={setOpen}
        items={[{ id, name }]}
        index={0}
        onIndexChange={() => undefined}
        renderImage={(it) => (
          <AttachmentPicture
            id={it.id}
            alt={it.name}
            className="max-h-[70dvh] max-w-full rounded-md object-contain"
          />
        )}
        onDownload={(it) =>
          void downloadAttachment(it.id).catch((e) => toast.error(apiErrorMessage(e)))
        }
      />
    </>
  );
}

/** Thumbnail 40x40 của một tệp ảnh trong danh sách đính kèm; bấm để mở lightbox. */
export function AttachmentThumb({
  id,
  name,
  onOpen,
}: {
  id: string;
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Xem ảnh ${name}`}
      className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded border border-border bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <AttachmentPicture
        id={id}
        alt={name}
        className="h-full w-full object-cover"
        placeholderClassName="h-full w-full rounded-none"
      />
    </button>
  );
}

/** Lightbox đi qua MỌI ảnh đính kèm của một công việc (`viewing` = chỉ số ảnh đang xem, null = đóng). */
export function AttachmentLightbox({
  images,
  viewing,
  onViewingChange,
  onDownload,
}: {
  images: Attachment[];
  viewing: number | null;
  onViewingChange: (index: number | null) => void;
  onDownload: (a: Attachment) => void;
}) {
  return (
    <Lightbox
      open={viewing !== null}
      onOpenChange={(o) => !o && onViewingChange(null)}
      items={images.map((a) => ({ id: a.id, name: a.fileName }))}
      index={Math.max(viewing ?? 0, 0)}
      onIndexChange={onViewingChange}
      renderImage={(it) => (
        <AttachmentPicture
          id={it.id}
          alt={it.name}
          className="max-h-[70dvh] max-w-full rounded-md object-contain"
        />
      )}
      onDownload={(it) => {
        const a = images.find((i) => i.id === it.id);
        if (a) onDownload(a);
      }}
    />
  );
}
