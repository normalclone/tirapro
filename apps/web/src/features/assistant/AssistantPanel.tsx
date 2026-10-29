import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, MessageCircle, Minus, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import { BOTTOM_BAR_PX, DESKTOP_MIN_QUERY } from '@/lib/bottomBar';
import { FAB_BOTTOM_CSS, FAB_RIGHT_CSS } from '@/lib/layoutTokens';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { keyboardInset, mobileWindowStyle, shouldRefocus } from './layout';
import { cn } from '@/lib/utils';
import type { Block, Chip } from './blocks';
import type { Message } from './conversation';
import { DraftCard, DraftCardView } from './DraftCard';
import { useAssistantPanel } from './panelStore';
import { useAssistantController, type SubmitOptions } from './useAssistant';

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:text-disabled-fg disabled:hover:bg-transparent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
    >
      {children}
    </button>
  );
}

const CHIP =
  'rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[13px] text-ink transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [@media(pointer:coarse)]:min-h-11';
const LINK =
  'inline-flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm';

/* ============================ Hiển thị (props-only, test được) ============================ */

interface BlocksProps {
  onChip: (chip: Chip) => void;
  onTour: () => void;
  /** Đóng panel khi bấm liên kết trong ứng dụng (đi tới việc / bộ lọc) để nội dung hiện ra. */
  onNavigate: () => void;
  renderDraft: (messageId: string, block: Extract<Block, { type: 'draft' }>) => ReactNode;
}

/** Một khối nội dung. Mọi chữ (kể cả tiêu đề việc do người dùng đặt) là TEXT của React — không `dangerouslySetInnerHTML`. */
function BlockView({ block, messageId, p }: { block: Block; messageId: string; p: BlocksProps }) {
  switch (block.type) {
    case 'text':
      return (
        <p className="max-w-[92%] whitespace-pre-line break-words rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-ink">
          {block.text}
        </p>
      );
    case 'links':
      return (
        <ul className="space-y-2">
          {block.items.map((it) => (
            <li
              key={it.to + it.title}
              className="rounded-lg border border-border bg-surface px-3.5 py-3"
            >
              <p className="text-sm font-medium text-ink-strong">{it.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{it.summary}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* Trang Hướng dẫn nằm ngoài khung ứng dụng (công khai) → mở tab mới như DocsLink, panel giữ nguyên. */}
                <a href={it.to} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {it.linkLabel}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
                {it.extra && (
                  <Link to={it.extra.to} onClick={p.onNavigate} className={LINK}>
                    {it.extra.label}
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ul>
      );
    case 'issues':
      return (
        <div className="rounded-lg border border-border bg-surface">
          <ul className="divide-y divide-border">
            {block.rows.map((r) => (
              <li key={r.key}>
                <Link
                  to={`/issue/${r.key}`}
                  onClick={p.onNavigate}
                  className="block px-3.5 py-2.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted">{r.key}</span>
                    <span className="min-w-0 truncate text-sm text-ink-strong">{r.summary}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>{r.status}</span>
                    {r.due && (
                      <span className={cn(r.overdue && 'font-medium text-danger')}>
                        Hạn {r.due}
                        {r.overdue ? ' · quá hạn' : ''}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-3.5 py-2">
            <Link to={block.seeAllTo} onClick={p.onNavigate} className={LINK}>
              Xem tất cả{block.more ? '' : ' trong bộ lọc'}
            </Link>
          </div>
        </div>
      );
    case 'facts':
      return (
        <section className="rounded-lg border border-border bg-surface px-3.5 py-3">
          <h3 className="break-words text-sm font-medium text-ink-strong">{block.title}</h3>
          <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            {block.rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className="min-w-0 break-words text-ink-strong">{r.value}</dd>
              </div>
            ))}
          </dl>
          {block.to && (
            <p className="mt-2">
              <Link to={block.to.to} onClick={p.onNavigate} className={LINK}>
                {block.to.label}
              </Link>
            </p>
          )}
        </section>
      );
    case 'tour':
      return (
        <div>
          <Button size="sm" variant="secondary" onClick={p.onTour}>
            {block.label}
          </Button>
        </div>
      );
    case 'chips':
      return (
        <div className="flex flex-wrap gap-1.5">
          {block.chips.map((c) => (
            <button
              key={c.label + (c.projectKey ?? '')}
              type="button"
              className={CHIP}
              onClick={() => p.onChip(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      );
    case 'draft':
      return <>{p.renderDraft(messageId, block)}</>;
  }
}

export interface AssistantPanelViewProps extends BlocksProps {
  onMinimize: () => void;
  onClose: () => void;
  messages: Message[];
  busy: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onClear: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  listRef?: Ref<HTMLDivElement>;
}

/** Nội dung panel: danh sách tin (vùng live) + ô nhập dưới cùng. Không hook dữ liệu → render tĩnh để test được. */
export function AssistantPanelView(props: AssistantPanelViewProps) {
  const {
    messages,
    busy,
    input,
    onInput,
    onSend,
    onClear,
    onMinimize,
    onClose,
    inputRef,
    listRef,
  } = props;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter gửi, Shift+Enter xuống dòng; không gửi khi đang gõ dở bộ gõ tiếng Việt (IME).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
        >
          <MessageCircle className="h-4 w-4" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-strong">
          Trợ lý Tirapro
        </h2>
        <HeaderButton label="Xoá hội thoại" onClick={onClear} disabled={messages.length === 0}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </HeaderButton>
        <HeaderButton label="Thu nhỏ" onClick={onMinimize}>
          <Minus className="h-4 w-4" aria-hidden />
        </HeaderButton>
        <HeaderButton label="Đóng" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </HeaderButton>
      </header>
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Hội thoại với Trợ lý Tirapro"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3"
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-line break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-fg">
                {m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')}
              </p>
            </div>
          ) : (
            <div key={m.id} className="space-y-2">
              {m.blocks.map((b, i) => (
                <BlockView key={i} block={b} messageId={m.id} p={props} />
              ))}
            </div>
          ),
        )}
        {busy && <p className="text-[13px] text-muted">Trợ lý đang tìm…</p>}
      </div>
      <div className="shrink-0 border-t border-border px-5 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-label="Nhập câu hỏi cho trợ lý"
            placeholder='Hỏi gì cũng được, hoặc gõ "tạo việc …"'
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button size="icon" onClick={onSend} disabled={!input.trim() || busy} aria-label="Gửi">
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-faint [@media(pointer:coarse)]:hidden">
          Enter gửi · Shift+Enter xuống dòng
        </p>
      </div>
    </div>
  );
}

/** Dựng thẻ nháp tĩnh (không hook) — dùng khi render để test. */
export const staticDraft: BlocksProps['renderDraft'] = (_id, block) => (
  <DraftCardView block={block} onCreate={noop} onOpenForm={noop} onCancel={noop} />
);
function noop() {
  /* test render */
}

/* ============================ Bong bóng + cửa sổ chat nổi ============================ */

/** Id bong bóng — focus trả về đây khi đóng bằng Esc/nút Đóng. */
const BUBBLE_ID = 'assistant-bubble';
const HEADER_BUTTON_ID = 'assistant-open-btn';

/** Theo dõi bàn phím ảo qua `visualViewport` (resize/scroll); gỡ listener khi tắt. */
function useKeyboardInset(enabled: boolean): { inset: number; offsetTop: number } {
  const [v, setV] = useState({ inset: 0, offsetTop: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const update = () =>
      setV({
        inset: keyboardInset(window.innerHeight, vv.height, vv.offsetTop),
        offsetTop: vv.offsetTop,
      });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setV({ inset: 0, offsetTop: 0 });
    };
  }, [enabled]);
  return v;
}

/** Nút mở trợ lý ở thanh đầu trang (cạnh nút trợ lý AI / hướng dẫn) — chỉ mở/đóng ô chat nổi. */
export function AssistantButton() {
  const open = useAssistantPanel((s) => s.open);
  const setOpen = useAssistantPanel((s) => s.setOpen);
  return (
    <Button
      id={HEADER_BUTTON_ID}
      variant="ghost"
      size="icon"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      title="Trợ lý Tirapro"
    >
      <MessageCircle className="h-4 w-4" aria-hidden />
      <span className="sr-only">Trợ lý Tirapro</span>
    </Button>
  );
}

/** Ô chat nổi kiểu Messenger. Mount một lần ở khung ứng dụng (ngoài khu quản trị) nên trạng thái sống qua các route. */
export function AssistantHost() {
  const userId = useAuth((s) => s.user?.id);
  // Đổi người dùng → hội thoại khác (khoá sessionStorage theo người dùng) → dựng lại.
  return <AssistantFloating key={userId ?? 'anon'} />;
}

function AssistantFloating() {
  const open = useAssistantPanel((s) => s.open);
  const minimized = useAssistantPanel((s) => s.minimized);
  const seen = useAssistantPanel((s) => s.seen);
  const setOpen = useAssistantPanel((s) => s.setOpen);
  const setMinimized = useAssistantPanel((s) => s.setMinimized);
  const desktop = useMediaQuery(DESKTOP_MIN_QUERY);
  const { messages, busy, submit, clear, patchDraft } = useAssistantController(open);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLElement>(null);
  const expandBtnRef = useRef<HTMLButtonElement>(null);
  // Đóng có chuyển động: giữ cửa sổ thêm một nhịp để chạy animation thoát rồi mới gỡ.
  const [closing, setClosing] = useState(false);
  const wantBubbleFocus = useRef(false);
  const kb = useKeyboardInset(open && !desktop);

  // `closing` bật ĐỒNG BỘ ngay trong lần vẽ mà `open` chuyển true → false (so sánh trong lúc render) để cửa sổ không biến mất
  // trước khi animation thoát kịp chạy; hẹn giờ gỡ sau 150ms.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setClosing(!open);
  }
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => setClosing(false), 150);
    return () => window.clearTimeout(t);
  }, [closing]);

  // Vào khu quản trị (host bị gỡ) thì đóng, để lần sau quay lại không tự bật.
  useEffect(() => () => useAssistantPanel.getState().setOpen(false), []);

  // Mở / bung ra → đưa con trỏ vào ô nhập. Mở từ Cmd+K: Radix của bảng lệnh trả focus về trang SAU khi ta focus, nên
  // thử lại vài nhịp và chỉ kéo focus về khi nó đang ở ngoài cửa sổ.
  useEffect(() => {
    if (!open || minimized) return;
    inputRef.current?.focus();
    const timers = [60, 200, 450].map((ms) =>
      window.setTimeout(() => {
        if (shouldRefocus(document.activeElement, document.body, winRef.current))
          inputRef.current?.focus();
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open, minimized]);

  // Thu nhỏ → focus sang nút "Bung" (nút Thu nhỏ vừa bị gỡ).
  useEffect(() => {
    if (open && minimized) expandBtnRef.current?.focus();
  }, [open, minimized]);

  // Đóng xong (bong bóng đã hiện lại) → trả focus về bong bóng.
  useEffect(() => {
    if (!open && !closing && wantBubbleFocus.current) {
      wantBubbleFocus.current = false;
      (document.getElementById(BUBBLE_ID) ?? document.getElementById(HEADER_BUTTON_ID))?.focus();
    }
  }, [open, closing]);

  // Tin mới → cuộn xuống cuối.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open, minimized]);

  const send = (text: string, opts?: SubmitOptions) => {
    setInput('');
    void submit(text, opts);
  };
  const close = () => {
    wantBubbleFocus.current = true;
    setOpen(false);
  };

  // Vị trí: desktop → bong bóng nằm BÊN TRÁI nút nổi "+" (menu của nút + mở lên trên, không đè bong bóng), cửa sổ nằm
  // TRÊN hàng nút; dưới lg (thanh tab đáy, không có nút nổi) → bong bóng ngay trên thanh, cửa sổ gần toàn màn.
  const style: CSSProperties = desktop
    ? {}
    : { bottom: `calc(${BOTTOM_BAR_PX}px + env(safe-area-inset-bottom) + 12px)`, right: 16 };

  if (!open && !closing)
    return (
      <button
        id={BUBBLE_ID}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở Trợ lý Tirapro"
        title="Trợ lý Tirapro"
        style={
          desktop
            ? { bottom: `calc(${FAB_BOTTOM_CSS} + 4px)`, right: `calc(${FAB_RIGHT_CSS} + 68px)` }
            : style
        }
        className={cn(
          'fixed z-sticky grid h-12 w-12 place-items-center rounded-full border border-border bg-surface text-primary shadow-lg',
          'transition-[background-color,transform] duration-fast ease-out-quart hover:bg-surface-2 active:scale-95',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          'motion-reduce:transition-none motion-reduce:active:scale-100',
        )}
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
        {!seen && (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-danger"
          />
        )}
      </button>
    );

  const winStyle: CSSProperties = desktop
    ? { bottom: `calc(${FAB_BOTTOM_CSS} + 68px)`, right: FAB_RIGHT_CSS }
    : mobileWindowStyle({ minimized, inset: kb.inset, offsetTop: kb.offsetTop });

  return (
    // Không modal: không lớp phủ, không khoá cuộn, không bẫy focus — trang phía sau vẫn dùng được. Esc (khi focus trong
    // cửa sổ) đóng và trả focus về bong bóng.
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Trợ lý Tirapro"
      ref={winRef}
      style={winStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
      className={cn(
        'fixed z-sticky flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg',
        'duration-base ease-out-quart motion-reduce:animate-none',
        open
          ? 'animate-in fade-in slide-in-from-bottom-2'
          : 'pointer-events-none animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards',
        desktop ? 'w-[360px] max-w-[calc(100vw-2rem)]' : 'w-[calc(100vw-16px)] sm:w-[360px]',
        minimized ? 'h-auto' : desktop ? 'h-[min(520px,calc(100dvh-8rem))]' : '',
      )}
    >
      {minimized ? (
        <button
          ref={expandBtnRef}
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Bung Trợ lý Tirapro"
          className="flex items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-fg"
          >
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="flex-1 text-sm font-semibold text-ink-strong">Trợ lý Tirapro</span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Đóng"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3"
          >
            <X className="h-4 w-4" aria-hidden />
          </span>
        </button>
      ) : (
        <AssistantPanelView
          messages={messages}
          busy={busy}
          input={input}
          onInput={setInput}
          onSend={() => send(input)}
          onClear={clear}
          onMinimize={() => setMinimized(true)}
          onClose={close}
          inputRef={inputRef}
          listRef={listRef}
          onChip={(c) =>
            send(c.text, { label: c.projectKey ? c.label : undefined, projectKey: c.projectKey })
          }
          onTour={() => window.dispatchEvent(new Event('tirapro:tour'))}
          onNavigate={() => {
            // Trang phía sau còn dùng được → ô chat giữ nguyên khi bấm liên kết; trên điện thoại (gần toàn màn) thì thu nhỏ để thấy trang.
            if (!desktop) setMinimized(true);
          }}
          renderDraft={(id, block) => (
            <DraftCard
              messageId={id}
              block={block}
              patch={patchDraft}
              onClose={() => {
                if (!desktop) setMinimized(true);
              }}
            />
          )}
        />
      )}
    </section>
  );
}
