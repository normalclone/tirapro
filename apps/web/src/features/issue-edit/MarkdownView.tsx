import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { parseMarkdown, type MdBlock } from './markdownParse';
import { MentionChip } from './MentionChip';

/* ----------------------------- Render markdown (tập con GFM) ----------------------------- */

// Token inline (nhóm có tên để thêm nhánh mới không phải đánh lại chỉ số): ảnh, liên kết,
// đậm, mã, gạch ngang (~~), nghiêng (* hoặc _), @mention `@[Tên](user:id)`.
const INLINE_SOURCE =
  '(?<img>!\\[(?<imgAlt>[^\\]]*)\\]\\((?<imgSrc>[^)\\s]+)\\))' +
  '|(?<link>\\[(?<linkText>[^\\]]+)\\]\\((?<linkHref>[^)\\s]+)\\))' +
  '|\\*\\*(?<bold>[^*]+)\\*\\*' +
  '|`(?<code>[^`]+)`' +
  '|~~(?<strike>[^~]+)~~' +
  '|\\*(?<em1>[^*]+)\\*' +
  '|_(?<em2>[^_]+)_' +
  '|(?<mention>@\\[(?<mentionName>[^\\]\\n]{1,80})\\]\\(user:(?<mentionId>[A-Za-z0-9_-]{1,64})\\))';

// Chống XSS lưu trữ: chỉ cho phép scheme an toàn. Liên kết chặn javascript:/data:;
// riêng ảnh cho thêm data:image vì thẻ ảnh không chạy được mã từ nguồn này.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/)/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/|\/)/i;
const safeHref = (u: string): string | null => (SAFE_HREF.test(u.trim()) ? u : null);
const safeImg = (u: string): string | null => (SAFE_IMG.test(u.trim()) ? u : null);

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SOURCE, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    const g = m.groups ?? {};
    if (m.index > last) out.push(text.slice(last, m.index));
    if (g.img !== undefined) {
      const src = safeImg(g.imgSrc!);
      out.push(
        src ? (
          <img
            key={k++}
            src={src}
            alt={g.imgAlt || 'Ảnh trong mô tả'}
            loading="lazy"
            className="my-2 block max-h-96 max-w-full rounded-md border border-border"
          />
        ) : (
          <span key={k++} className="text-faint">
            {g.imgAlt || '[Đường dẫn ảnh không hợp lệ]'}
          </span>
        ),
      );
    } else if (g.link !== undefined) {
      const href = safeHref(g.linkHref!);
      out.push(
        href ? (
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            {g.linkText}
          </a>
        ) : (
          <span key={k++}>{g.linkText}</span>
        ),
      );
    } else if (g.bold !== undefined) {
      out.push(
        <strong key={k++} className="font-semibold text-ink-strong">
          {g.bold}
        </strong>,
      );
    } else if (g.code !== undefined) {
      out.push(
        <code key={k++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
          {g.code}
        </code>,
      );
    } else if (g.strike !== undefined) {
      out.push(
        <del key={k++} className="text-muted">
          {g.strike}
        </del>,
      );
    } else if (g.mention !== undefined) {
      out.push(<MentionChip key={k++} id={g.mentionId!} name={g.mentionName!} />);
    } else {
      out.push(<em key={k++}>{g.em1 ?? g.em2}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING_CLASS = {
  1: 'text-base font-semibold',
  2: 'text-sm font-semibold',
  3: 'text-sm font-medium',
} as const;

function renderBlock(
  b: MdBlock,
  key: number,
  onToggleTask: ((index: number, checked: boolean, itemText: string) => void) | undefined,
): ReactNode {
  switch (b.type) {
    case 'blank':
      return <div key={key} className="h-2" />;
    case 'heading':
      return (
        <p key={key} className={cn('mt-2 text-ink-strong', HEADING_CLASS[b.level])}>
          {renderInline(b.text)}
        </p>
      );
    case 'paragraph':
      return (
        <p key={key} className="leading-relaxed">
          {renderInline(b.text)}
        </p>
      );
    case 'quote':
      return (
        <blockquote key={key} className="my-1 rounded-md bg-surface-2 px-3 py-1.5 text-muted">
          {b.lines.map((l, i) => (
            <p key={i} className="leading-relaxed">
              {renderInline(l)}
            </p>
          ))}
        </blockquote>
      );
    case 'code':
      return (
        <pre
          key={key}
          className="my-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-xs"
        >
          <code>{b.text}</code>
        </pre>
      );
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={cn('my-1 space-y-0.5 pl-5', b.ordered ? 'list-decimal' : 'list-disc')}
        >
          {b.items.map((it, i) => (
            <li
              key={i}
              className={it.task ? '-ml-5 list-none' : undefined}
              style={it.depth ? { marginLeft: `${it.depth}rem` } : undefined}
            >
              {it.task ? (
                <label
                  className="flex items-start gap-2"
                  // Không để bấm ô tick làm "bấm để sửa" của khung bao ngoài kích hoạt.
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={it.task.checked}
                    disabled={!onToggleTask}
                    aria-label={it.task.text || 'Mục công việc'}
                    onChange={(e) =>
                      onToggleTask?.(it.task!.index, e.target.checked, it.task!.text)
                    }
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className={cn(it.task.checked && 'text-muted line-through')}>
                    {renderInline(it.text)}
                  </span>
                </label>
              ) : (
                renderInline(it.text)
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div key={key} className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th
                    key={i}
                    className="border border-border bg-surface-2 px-2 py-1 text-left font-medium"
                    style={b.align[i] ? { textAlign: b.align[i] } : undefined}
                  >
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="border border-border px-2 py-1"
                      style={b.align[ci] ? { textAlign: b.align[ci] } : undefined}
                    >
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * Trình render Markdown nhẹ (không `dangerouslySetInnerHTML` nên an toàn XSS theo cấu trúc): tiêu đề, danh sách
 * (gạch đầu dòng / số / ô tick), bảng, trích dẫn, khối mã, đậm/nghiêng/gạch/mã/liên kết/ảnh.
 * Có `onToggleTask` → ô tick bấm được (nhận chỉ số theo `listTaskItems`); không có → ô tick chỉ đọc.
 */
export function MarkdownView({
  text,
  onToggleTask,
}: {
  text: string;
  onToggleTask?: (index: number, checked: boolean, itemText: string) => void;
}) {
  return (
    <div className="text-sm text-ink">
      {parseMarkdown(text).map((b, i) => renderBlock(b, i, onToggleTask))}
    </div>
  );
}
