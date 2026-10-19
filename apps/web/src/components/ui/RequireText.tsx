import { useEffect, useId, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react';
import { Input } from '@/components/ui/Input';
import { matchesConfirmText, normalizeConfirmText, shouldSubmitOnEnter } from '@/lib/confirmText';

/** Safari phát Enter ngay sau `compositionend`; cửa sổ này đủ rộng cho hai sự kiện liền nhau, vẫn hẹp hơn nhịp gõ người. */
const JUST_COMPOSED_MS = 100;

interface TypedState {
  seq: number;
  value: string;
  composing: boolean;
}

/**
 * Trạng thái ô "gõ tên để xác nhận". `seq` là số lần mở hộp: chữ đã gõ gắn với `seq` nên mở lại là ô trống ngay
 * trong commit đầu (không đợi effect reset). `matches` = đã khớp (hoặc không bắt gõ); đang gõ dở bằng bộ gõ
 * (Telex/VNI) thì chưa tính khớp.
 */
export function useRequireText(expected: string | undefined, seq: number) {
  const [state, setState] = useState<TypedState>({ seq, value: '', composing: false });
  const justComposedRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const cur = state.seq === seq ? state : { seq, value: '', composing: false };
  const required = !!expected && normalizeConfirmText(expected) !== '';
  return {
    required,
    value: cur.value,
    matches: !required || (!cur.composing && matchesConfirmText(cur.value, expected ?? '')),
    justComposedRef,
    bind: {
      value: cur.value,
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        setState({ seq, value: e.target.value, composing: cur.composing }),
      onCompositionStart: () => setState({ seq, value: cur.value, composing: true }),
      onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
        setState({ seq, value: e.currentTarget.value, composing: false });
        justComposedRef.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          justComposedRef.current = false;
        }, JUST_COMPOSED_MS);
      },
    },
  };
}

export type RequireTextState = ReturnType<typeof useRequireText>;

/** Nhãn nêu rõ chữ cần gõ + ô nhập (focus ngay khi hộp mở). Enter xác nhận khi đã khớp (xem `shouldSubmitOnEnter`). */
export function RequireTextField({
  expected,
  text,
  onEnter,
}: {
  expected: string;
  text: RequireTextState;
  onEnter: () => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm text-ink">
        Gõ <strong className="break-all font-semibold text-ink-strong">{expected}</strong> để xác
        nhận
      </label>
      <Input
        id={id}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        {...text.bind}
        onKeyDown={(e) => {
          const justComposed = text.justComposedRef.current;
          text.justComposedRef.current = false; // chỉ chặn đúng phím kế tiếp
          if (
            shouldSubmitOnEnter({
              key: e.key,
              isComposing: e.nativeEvent.isComposing,
              keyCode: e.nativeEvent.keyCode,
              justComposed,
              matches: text.matches,
            })
          ) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
}
