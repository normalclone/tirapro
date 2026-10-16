import { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import { Lightbox } from '@/components/ui/Lightbox';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { downloadAttachment, useAttachmentUrl } from './api';

/**
 * Ảnh đính kèm (blob có token) với khung giữ chỗ chống nhảy layout và khung lỗi "Không xem được ảnh".
 * Blob URL bị đẩy khỏi bộ nhớ đệm (quá 60 ảnh) thì `onError` nạp lại đúng một lần.
 */
export function AttachmentPicture({
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
