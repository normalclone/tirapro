import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_DIM = 256;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Thu nhỏ ảnh về tối đa 256px (giữ tỉ lệ) và xuất PNG — nhẹ, hợp avatar/logo. */
async function downscale(file: File): Promise<File> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error('Không đọc được tệp'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Ảnh không hợp lệ'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return file;
  return new File([blob], 'avatar.png', { type: 'image/png' });
}

/**
 * Khối tải ảnh đại diện dùng chung (user / workspace / project).
 * Tự thu nhỏ ảnh phía client trước khi gửi multipart qua `uploadFn`.
 */
export function AvatarUploader({
  name,
  src,
  shape = 'circle',
  size = 72,
  uploadFn,
  onRemove,
  disabled,
  hint,
}: {
  name: string;
  src?: string | null;
  shape?: 'circle' | 'rounded';
  size?: number;
  uploadFn: (file: File) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại cùng tệp
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error('Chỉ chấp nhận ảnh PNG, JPG, WEBP hoặc GIF');
      return;
    }
    setBusy(true);
    try {
      const small = await downscale(file).catch(() => file);
      await uploadFn(small);
      toast.success('Đã cập nhật ảnh');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!onRemove) return;
    setBusy(true);
    try {
      await onRemove();
      toast.success('Đã gỡ ảnh');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-xl';

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          'relative grid shrink-0 place-items-center overflow-hidden border border-border bg-surface-2',
          radius,
        )}
        style={{ width: size, height: size }}
      >
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="font-semibold text-muted" style={{ fontSize: size * 0.36 }}>
            {(name || '?').charAt(0).toUpperCase()}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-bg/60">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={onPick}
            disabled={disabled || busy}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />
            {src ? 'Đổi ảnh' : 'Tải ảnh lên'}
          </Button>
          {src && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={remove}
              className="text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
              Gỡ
            </Button>
          )}
        </div>
        <p className="text-xs text-faint">{hint ?? 'PNG, JPG, WEBP hoặc GIF · tự thu nhỏ về 256px'}</p>
      </div>
    </div>
  );
}
