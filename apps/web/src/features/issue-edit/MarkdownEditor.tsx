import { useRef, type ReactNode } from 'react';
import { Bold, Code, Heading2, Image as ImageIcon, Italic, Link2, List } from 'lucide-react';

function ToolBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-7 w-7 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {children}
    </button>
  );
}

/**
 * Editor Markdown cơ bản (controlled): thanh công cụ (đậm/nghiêng/mã/tiêu đề/danh sách/liên kết/ảnh)
 * + textarea. Chèn cú pháp quanh vùng chọn, giữ con trỏ. Dùng cho cả chi tiết & popup tạo issue.
 */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  autoFocus,
  rows = 6,
  placeholder = 'Nhập nội dung… (viết được Markdown; chèn ảnh bằng ![](đường-dẫn))',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(
    fn: (val: string, s: number, e: number) => { value: string; selStart: number; selEnd: number },
  ) {
    const ta = ref.current;
    if (!ta) return;
    const r = fn(ta.value, ta.selectionStart, ta.selectionEnd);
    onChange(r.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.selStart, r.selEnd);
    });
  }

  const wrap = (marker: string, ph: string) =>
    apply((val, s, e) => {
      const sel = val.slice(s, e) || ph;
      return {
        value: val.slice(0, s) + marker + sel + marker + val.slice(e),
        selStart: s + marker.length,
        selEnd: s + marker.length + sel.length,
      };
    });

  const linePrefix = (prefix: string) =>
    apply((val, s, e) => {
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      return {
        value: val.slice(0, ls) + prefix + val.slice(ls),
        selStart: s + prefix.length,
        selEnd: e + prefix.length,
      };
    });

  const insert = (text: string) =>
    apply((val, s, e) => {
      const value = val.slice(0, s) + text + val.slice(e);
      const pos = s + text.length;
      return { value, selStart: pos, selEnd: pos };
    });

  function insertLink() {
    const url = window.prompt('Dán đường dẫn (URL) muốn liên kết tới:');
    if (!url) return;
    apply((val, s, e) => {
      const md = `[${val.slice(s, e) || 'liên kết'}](${url})`;
      return {
        value: val.slice(0, s) + md + val.slice(e),
        selStart: s + md.length,
        selEnd: s + md.length,
      };
    });
  }

  function insertImage() {
    const url = window.prompt('Dán đường dẫn (URL) của ảnh muốn chèn:');
    if (url) insert(`\n![](${url})\n`);
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface focus-within:border-primary">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        <ToolBtn title="Bôi đậm chữ đang chọn" onClick={() => wrap('**', 'văn bản')}>
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="In nghiêng chữ đang chọn" onClick={() => wrap('*', 'văn bản')}>
          <Italic className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Định dạng chữ đang chọn thành đoạn mã" onClick={() => wrap('`', 'code')}>
          <Code className="h-4 w-4" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolBtn title="Biến dòng hiện tại thành tiêu đề mục" onClick={() => linePrefix('## ')}>
          <Heading2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Biến dòng hiện tại thành gạch đầu dòng" onClick={() => linePrefix('- ')}>
          <List className="h-4 w-4" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolBtn title="Chèn liên kết tới một đường dẫn" onClick={insertLink}>
          <Link2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Chèn ảnh từ một đường dẫn" onClick={insertImage}>
          <ImageIcon className="h-4 w-4" />
        </ToolBtn>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          if (onCancel && e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className="block w-full resize-y bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-faint"
      />
    </div>
  );
}
