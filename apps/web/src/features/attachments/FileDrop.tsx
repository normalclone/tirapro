import { useEffect, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Ảnh thu nhỏ của tệp ảnh chọn cục bộ; `blob:` URL được thu hồi khi tệp bị bỏ / hộp đóng. */
function FileThumb({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  const isImage = file.type.startsWith('image/');
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);
  if (src)
    return <img src={src} alt="" className="h-8 w-8 shrink-0 rounded object-cover" aria-hidden />;
  return <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />;
}

/** Vùng chọn/kéo-thả tệp (giữ cục bộ tới khi công việc được tạo rồi mới tải lên). */
export function FileDrop({
  files,
  onAdd,
  onRemove,
}: {
  files: File[];
  onAdd: (f: File[]) => void;
  onRemove: (i: number) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onAdd(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-5 text-center text-sm transition-colors',
          over
            ? 'border-primary bg-primary-subtle/40 text-ink'
            : 'border-border text-muted hover:border-primary hover:text-ink',
        )}
      >
        <Paperclip className="h-4 w-4" aria-hidden />
        <span>
          Kéo thả tệp vào đây hoặc <span className="font-medium text-primary">bấm để chọn tệp</span>
        </span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdd(Array.from(e.target.files));
            e.currentTarget.value = '';
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
            >
              <FileThumb file={f} />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span className="shrink-0 text-xs text-faint tabular">{fmtSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Bỏ tệp ${f.name} khỏi danh sách đính kèm`}
                title="Bỏ tệp này"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
