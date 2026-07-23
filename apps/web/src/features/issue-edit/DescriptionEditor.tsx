import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Code, Heading2, Image as ImageIcon, Italic, Link2, List } from 'lucide-react';
import { toast } from 'sonner';
import type { IssueDto } from '@tirapro/types';
import { useUpdateIssue } from '@/features/issues/api';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ----------------------------- Render markdown cơ bản ----------------------------- */

// Token inline: ảnh, liên kết, đậm, mã, nghiêng (* hoặc _).
const INLINE = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;

// Chống XSS lưu trữ: chỉ cho phép scheme an toàn. Link chặn javascript:/data:; ảnh cho thêm data:image (an toàn trong <img>).
const SAFE_HREF = /^(https?:\/\/|mailto:|\/)/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/|\/)/i;
const safeHref = (u: string): string | null => (SAFE_HREF.test(u.trim()) ? u : null);
const safeImg = (u: string): string | null => (SAFE_IMG.test(u.trim()) ? u : null);

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined && m[2] !== undefined) {
      const src = safeImg(m[2]);
      out.push(src
        ? <img key={k++} src={src} alt={m[1]} loading="lazy" className="my-2 block max-h-96 max-w-full rounded-md border border-border" />
        : <span key={k++} className="text-faint">{m[1] || '[ảnh không hợp lệ]'}</span>);
    } else if (m[3] !== undefined && m[4] !== undefined) {
      const href = safeHref(m[4]);
      out.push(href
        ? <a key={k++} href={href} target="_blank" rel="noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{m[3]}</a>
        : <span key={k++}>{m[3]}</span>);
    } else if (m[5] !== undefined) {
      out.push(<strong key={k++} className="font-semibold text-ink-strong">{m[5]}</strong>);
    } else if (m[6] !== undefined) {
      out.push(<code key={k++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{m[6]}</code>);
    } else {
      out.push(<em key={k++}>{m[7] ?? m[8]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Trình render Markdown nhẹ: tiêu đề (#/##/###), danh sách (-/*), đậm/nghiêng/mã/liên kết/ảnh. */
export function MarkdownView({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (list && list.length) {
      const items = list;
      blocks.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ul>,
      );
    }
    list = null;
  };

  for (const line of lines) {
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { (list ??= []).push(li[1] ?? ''); continue; }
    flushList();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1]!.length === 1 ? 'text-base font-semibold' : h[1]!.length === 2 ? 'text-sm font-semibold' : 'text-sm font-medium';
      blocks.push(<p key={key++} className={cn('mt-2 text-ink-strong', size)}>{renderInline(h[2] ?? '')}</p>);
      continue;
    }
    if (line.trim() === '') { blocks.push(<div key={key++} className="h-2" />); continue; }
    blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
  }
  flushList();

  return <div className="text-sm text-ink">{blocks}</div>;
}

/* ----------------------------- Editor Markdown cơ bản (dùng lại) ----------------------------- */

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
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
  placeholder = 'Mô tả (Markdown cơ bản, ảnh: ![](url))…',
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

  function apply(fn: (val: string, s: number, e: number) => { value: string; selStart: number; selEnd: number }) {
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
      return { value: val.slice(0, s) + marker + sel + marker + val.slice(e), selStart: s + marker.length, selEnd: s + marker.length + sel.length };
    });

  const linePrefix = (prefix: string) =>
    apply((val, s, e) => {
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      return { value: val.slice(0, ls) + prefix + val.slice(ls), selStart: s + prefix.length, selEnd: e + prefix.length };
    });

  const insert = (text: string) =>
    apply((val, s, e) => {
      const value = val.slice(0, s) + text + val.slice(e);
      const pos = s + text.length;
      return { value, selStart: pos, selEnd: pos };
    });

  function insertLink() {
    const url = window.prompt('Dán URL liên kết:');
    if (!url) return;
    apply((val, s, e) => {
      const md = `[${val.slice(s, e) || 'liên kết'}](${url})`;
      return { value: val.slice(0, s) + md + val.slice(e), selStart: s + md.length, selEnd: s + md.length };
    });
  }

  function insertImage() {
    const url = window.prompt('Dán URL ảnh:');
    if (url) insert(`\n![](${url})\n`);
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface focus-within:border-primary">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        <ToolBtn title="Đậm" onClick={() => wrap('**', 'văn bản')}><Bold className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Nghiêng" onClick={() => wrap('*', 'văn bản')}><Italic className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Mã" onClick={() => wrap('`', 'code')}><Code className="h-4 w-4" /></ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolBtn title="Tiêu đề" onClick={() => linePrefix('## ')}><Heading2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Danh sách" onClick={() => linePrefix('- ')}><List className="h-4 w-4" /></ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <ToolBtn title="Chèn liên kết" onClick={insertLink}><Link2 className="h-4 w-4" /></ToolBtn>
        <ToolBtn title="Chèn ảnh" onClick={insertImage}><ImageIcon className="h-4 w-4" /></ToolBtn>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit(); }
          if (onCancel && e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className="block w-full resize-y bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-faint"
      />
    </div>
  );
}

/**
 * Mô tả issue: xem (render Markdown, dạng label) → bấm để sửa bằng MarkdownEditor.
 * Lưu bằng nút hoặc ⌘/Ctrl+Enter, Esc để huỷ.
 */
export function IssueDescription({ issue }: { issue: IssueDto }) {
  const patch = useUpdateIssue(issue.projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.description ?? '');

  useEffect(() => { if (!editing) setDraft(issue.description ?? ''); }, [issue.description, editing]);

  function start() { setDraft(issue.description ?? ''); setEditing(true); }
  function cancel() { setEditing(false); setDraft(issue.description ?? ''); }
  function save() {
    const next = draft.trim() === '' ? null : draft;
    setEditing(false);
    if (next === (issue.description ?? null)) return;
    patch.mutate(
      { id: issue.id, key: issue.key, patch: { description: next }, version: issue.version },
      { onError: (e) => toast.error(apiErrorMessage(e)) },
    );
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <MarkdownEditor value={draft} onChange={setDraft} onSubmit={save} onCancel={cancel} autoFocus rows={8} />
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-faint">Markdown cơ bản · ⌘/Ctrl+Enter để lưu · Esc huỷ</span>
          <Button size="sm" variant="ghost" onClick={cancel}>Huỷ</Button>
          <Button size="sm" onClick={save} loading={patch.isPending}>Lưu</Button>
        </div>
      </div>
    );
  }

  if (!issue.description) {
    return (
      <button
        type="button"
        onClick={start}
        className="w-full rounded-md border border-dashed border-border px-3 py-2.5 text-left text-sm text-faint transition-colors hover:border-primary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Thêm mô tả…
      </button>
    );
  }

  return (
    <div
      onClick={start}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }}
      title="Bấm để sửa"
      className="cursor-text rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      <MarkdownView text={issue.description} />
    </div>
  );
}
