import { Check, Pencil, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { apiErrorMessage } from '@/lib/api';
import { inlineKeyAction, inlineStatus, type InlineEditState } from '@/lib/inlineEdit';
import { useJustComposed } from '@/lib/useJustComposed';
import { useInlineEdit } from './useInlineEdit';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { FieldErrorText } from './FieldError';
import { Input } from './Input';
import { SaveStatus } from './SaveStatus';

/** Chặn mousedown để bấm ✓/✕/Thử lại không làm ô nhập mất focus (blur sẽ lưu trước cả khi nút kịp nhận click; Safari không focus nút khi bấm). */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Lời lỗi nhập (rỗng / quá dài) hoặc lỗi lưu, hoặc null. */
function messageOf(s: InlineEditState, label: string, max: number | undefined): string | null {
  if (s.phase === 'error') return s.message;
  if (s.phase === 'editing' && s.invalid === 'empty') return `${label} không được để trống.`;
  if (s.phase === 'editing' && s.invalid === 'tooLong') return `${label} tối đa ${max} ký tự.`;
  return null;
}

/**
 * Sửa một dòng chữ tại chỗ (tiêu đề công việc ở trang chi tiết và panel xem nhanh). Máy trạng thái ở `lib/inlineEdit`.
 * - Xem: tiêu đề là `<button>` (Tab tới được, Enter/Space/bấm để sửa; bút chì hiện khi rê/focus, luôn mờ nhỏ trên cảm ứng).
 *   Chỉ một thẻ tiêu đề (`as`) — không quyền sửa thì chỉ là chữ.
 * - Sửa: Enter lưu (không khi bộ gõ đang soạn), Esc huỷ và trả giá trị cũ (preventDefault để panel/thanh chọn hàng loạt biết
 *   Esc này đã dùng), Shift+Enter không làm gì. ✓ "Lưu" / ✕ "Huỷ" cao 44px trên cảm ứng. Rời ô (blur) = lưu, như bản cũ ở
 *   cả chi tiết lẫn panel — trừ khi focus chỉ chuyển sang nút trong chính khối này.
 * - Không gửi đôi (Enter rồi blur), không đổi sau trim → không gọi `onSave`, rỗng → báo lỗi ngay tại ô và giữ ô mở.
 * - `SaveStatus`: Đang lưu… / Đã lưu lúc… / Lỗi · Thử lại (gửi lại GIÁ TRỊ LẦN CUỐI).
 */
export function InlineText({
  value,
  label,
  onSave,
  canEdit,
  as: Tag = 'h2',
  className,
  textClassName,
  inputClassName,
  maxLength = 255,
  title,
  editRequest = 0,
  onEditingChange,
  onEditStart,
  describeError = apiErrorMessage,
}: {
  /** Giá trị đã lưu (nguồn sự thật; đổi từ ngoài khi đang xem thì hiện ngay). */
  value: string;
  /** Nhãn của ô nhập (tên truy cập), vd "Tiêu đề". */
  label: string;
  /** Lưu giá trị đã trim; ném lỗi để vào trạng thái lỗi. Đọc qua ref nên luôn dùng bản mới nhất (version OCC mới). */
  onSave: (next: string, attempt: number) => Promise<unknown>;
  canEdit: boolean;
  as?: 'h1' | 'h2';
  className?: string;
  textClassName?: string;
  inputClassName?: string;
  maxLength?: number;
  /** Gợi ý khi rê chuột lên tiêu đề (vd kèm phím tắt). */
  title?: string;
  /** Tăng số này để mở ô sửa từ ngoài (phím `e`, điều hướng kèm state); bỏ qua khi không có quyền. */
  editRequest?: number;
  onEditingChange?: (editing: boolean) => void;
  /** Gọi đồng bộ khi VÀO chế độ sửa (chụp version lạc quan cho lần lưu đầu). */
  onEditStart?: () => void;
  describeError?: (e: unknown) => string;
}) {
  const { state, stateRef, savedAt, submit, retry, start, cancel, change } = useInlineEdit({
    value,
    onSave,
    onEditStart,
    describeError,
    maxLength,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const composed = useJustComposed();
  const uid = useId();
  const errId = `${uid}-err`;
  const hintId = `${uid}-hint`;

  // Mở từ ngoài (bỏ qua giá trị đầu tiên).
  const lastRequest = useRef(editRequest);
  useEffect(() => {
    if (editRequest === lastRequest.current) return;
    lastRequest.current = editRequest;
    if (canEdit) start();
  }, [editRequest, canEdit, start]);

  const editing = state.phase !== 'view';
  useEditFocus(editing, { rootRef, inputRef, viewRef }, onEditingChange);
  // Mất quyền sửa giữa chừng → thoát chế độ sửa.
  useEffect(() => {
    if (!canEdit) cancel();
  }, [canEdit, cancel]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (stateRef.current.phase === 'view') return;
    const onInput = e.target === inputRef.current;
    if (e.key === 'Enter' && !onInput) return; // Enter trên ✓/✕/Thử lại kích hoạt nút như thường
    const action = inlineKeyAction({
      key: e.key,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
      keyCode: e.nativeEvent.keyCode,
      justComposed: composed.take(),
    });
    if (action === 'save') {
      e.preventDefault();
      submit();
    } else if (action === 'swallow') {
      e.preventDefault();
    } else if (action === 'cancel') {
      const before = stateRef.current;
      if (cancel() !== before) e.preventDefault(); // Esc đã dùng để huỷ sửa
    }
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (stateRef.current.phase !== 'editing') return; // đang lưu / đang báo lỗi: không tự gửi
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    submit();
  }

  const message = messageOf(state, label, maxLength);
  const saving = state.phase === 'saving';
  const status = inlineStatus(state, savedAt);

  return (
    <div
      ref={rootRef}
      className={cn('min-w-0', className)}
      // Phím tắt toàn cục bỏ qua khi focus ở BẤT KỲ nút nào trong khối đang sửa (✓/✕/Thử lại), không chỉ ô nhập.
      data-inline-edit={editing ? '' : undefined}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="flex items-center gap-1.5">
        {editing ? (
          <Tag className="min-w-0 flex-1">
            <Input
              ref={inputRef}
              aria-label={label}
              value={state.draft}
              onChange={(e) => change(e.target.value)}
              onCompositionEnd={composed.onCompositionEnd}
              readOnly={saving}
              maxLength={maxLength}
              autoComplete="off"
              enterKeyHint="done"
              invalid={message !== null}
              aria-describedby={message ? errId : undefined}
              className={inputClassName}
            />
          </Tag>
        ) : (
          <Tag className="min-w-0 flex-1">
            <InlineView
              value={value}
              canEdit={canEdit}
              onStart={start}
              viewRef={viewRef}
              title={title}
              hintId={hintId}
              textClassName={textClassName}
            />
          </Tag>
        )}
        {editing && <EditButtons saving={saving} onSave={submit} onCancel={cancel} />}
        <span onMouseDown={keepFocus} className="shrink-0 whitespace-nowrap">
          <SaveStatus status={status} onRetry={retry} />
        </span>
      </div>
      {!editing && canEdit && (
        <span id={hintId} className="sr-only">
          Bấm hoặc nhấn Enter để sửa {label.toLowerCase()}
        </span>
      )}
      {message && (
        <div role="alert">
          <FieldErrorText id={errId}>{message}</FieldErrorText>
        </div>
      )}
    </div>
  );
}

/** Chế độ xem: tiêu đề là nút (Tab/Enter/Space/bấm để sửa) khi có quyền, không thì chỉ là chữ. */
function InlineView({
  value,
  canEdit,
  onStart,
  viewRef,
  title,
  hintId,
  textClassName,
}: {
  value: string;
  canEdit: boolean;
  onStart: () => void;
  viewRef: RefObject<HTMLButtonElement>;
  title?: string;
  hintId: string;
  textClassName?: string;
}) {
  if (!canEdit)
    return <span className={cn('-mx-1 block break-words px-1', textClassName)}>{value}</span>;
  return (
    <button
      ref={viewRef}
      type="button"
      onClick={onStart}
      title={title}
      aria-describedby={hintId}
      className={cn(
        'group -mx-1 inline-flex w-full items-start gap-1.5 rounded px-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center',
        textClassName,
      )}
    >
      <span className="min-w-0 break-words">{value}</span>
      <Pencil
        className="mt-1.5 h-3.5 w-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:mt-0 [@media(pointer:coarse)]:opacity-60"
        aria-hidden
      />
    </button>
  );
}

/** ✓ Lưu / ✕ Huỷ (44px trên cảm ứng — `Button size="icon"`); mousedown không cướp focus của ô nhập. */
function EditButtons({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Lưu"
        title="Lưu (Enter)"
        loading={saving}
        onMouseDown={keepFocus}
        onClick={onSave}
      >
        <Check className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Huỷ"
        title="Huỷ (Esc)"
        disabled={saving}
        onMouseDown={keepFocus}
        onClick={onCancel}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </>
  );
}

/**
 * Vào chế độ sửa → focus + chọn hết chữ; ra khỏi sửa → trả focus về tiêu đề (không cuộn trang) nếu focus đang trôi
 * (body / trong khối này) — rời bằng blur sang chỗ khác thì không cướp focus.
 */
function useEditFocus(
  editing: boolean,
  refs: {
    rootRef: RefObject<HTMLDivElement>;
    inputRef: RefObject<HTMLInputElement>;
    viewRef: RefObject<HTMLButtonElement>;
  },
  onEditingChange?: (editing: boolean) => void,
) {
  const wasEditing = useRef(false);
  useEffect(() => {
    onEditingChange?.(editing);
    if (editing && !wasEditing.current) {
      refs.inputRef.current?.focus();
      refs.inputRef.current?.select();
    } else if (!editing && wasEditing.current) {
      const a = document.activeElement;
      if (!a || a === document.body || refs.rootRef.current?.contains(a))
        refs.viewRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
}
