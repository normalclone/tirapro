import { useRef, type ReactNode } from 'react';
import {
  AtSign,
  Bold,
  Code,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  Table2,
} from 'lucide-react';
import { insertTableTemplate, toggleLinePrefix } from './markdownEdit';
import type { MentionPerson } from './mentionQuery';
import { MentionPopup } from './MentionPopup';
import { useMentionPopup } from './useMentionPopup';

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

/** Thanh công cụ của MarkdownEditor (thuần trình bày — logic chèn cú pháp nằm ở editor). */
function MarkdownToolbar({
  wrap,
  linePrefix,
  insertLink,
  insertImage,
  toggleChecklist,
  insertTable,
  insertAt,
}: {
  wrap: (marker: string, placeholder: string) => void;
  linePrefix: (prefix: string) => void;
  insertLink: () => void;
  insertImage: () => void;
  toggleChecklist: () => void;
  insertTable: () => void;
  /** Có → hiện nút @ (chỉ khi editor bật popup nhắc tên). */
  insertAt?: () => void;
}) {
  return (
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
      <ToolBtn
        title="Biến các dòng đang chọn thành danh sách ô tick (bấm lại để bỏ)"
        onClick={toggleChecklist}
      >
        <ListChecks className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn title="Chèn bảng mẫu 3 cột" onClick={insertTable}>
        <Table2 className="h-4 w-4" />
      </ToolBtn>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <ToolBtn title="Chèn liên kết tới một đường dẫn" onClick={insertLink}>
        <Link2 className="h-4 w-4" />
      </ToolBtn>
      <ToolBtn title="Chèn ảnh từ một đường dẫn" onClick={insertImage}>
        <ImageIcon className="h-4 w-4" />
      </ToolBtn>
      {insertAt && (
        <ToolBtn title="Nhắc đến một người (@)" onClick={insertAt}>
          <AtSign className="h-4 w-4" />
        </ToolBtn>
      )}
    </div>
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
  mentionPeople,
  textareaId,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
  /** Có → bật popup @ (gõ `@` hoặc nút @); không có → không gợi ý và không tốn request. */
  mentionPeople?: MentionPerson[];
  /** `id` của <textarea> — để nơi khác (vd phím tắt) tìm và focus ô này. */
  textareaId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionPopup(ref, mentionPeople, onChange);

  function insertAt() {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const needSpace = s > 0 && !/\s/.test(ta.value[s - 1]!);
    const text = `${needSpace ? ' ' : ''}@`;
    apply((val, a, b) => {
      const pos = a + text.length;
      return { value: val.slice(0, a) + text + val.slice(b), selStart: pos, selEnd: pos };
    });
    requestAnimationFrame(() => mention.syncTrigger()); // chạy sau rAF đặt con trỏ của `apply`
  }

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

  const toggleChecklist = () => apply((val, s, e) => toggleLinePrefix(val, s, e, '- [ ] '));
  const insertTable = () => apply((val, s) => insertTableTemplate(val, s));

  function insertImage() {
    const url = window.prompt('Dán đường dẫn (URL) của ảnh muốn chèn:');
    if (url) insert(`\n![](${url})\n`);
  }

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-md border border-border bg-surface focus-within:border-primary">
        <MarkdownToolbar
          wrap={wrap}
          linePrefix={linePrefix}
          insertLink={insertLink}
          insertImage={insertImage}
          toggleChecklist={toggleChecklist}
          insertTable={insertTable}
          insertAt={mentionPeople ? insertAt : undefined}
        />
        <textarea
          ref={ref}
          id={textareaId}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            mention.syncTrigger(e.target.value, e.target.selectionStart);
          }}
          onKeyUp={() => mention.syncTrigger()}
          onClick={() => mention.syncTrigger()}
          onBlur={mention.close}
          rows={rows}
          {...mention.aria}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (mention.handleKey(e)) return;
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
      {mention.popupOpen && (
        <MentionPopup
          id={mention.listId}
          people={mention.candidates}
          activeIndex={mention.activeIdx}
          onPick={mention.pick}
          onHover={mention.setActive}
        />
      )}
    </div>
  );
}
