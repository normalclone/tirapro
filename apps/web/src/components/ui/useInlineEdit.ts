import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  INLINE_VIEW,
  inlineEditReducer,
  type InlineEditAction,
  type InlineEditState,
} from '@/lib/inlineEdit';

const SAVED_FLASH_MS = 4000;

/**
 * Trạng thái + hành động của ô sửa tại chỗ. Trạng thái nằm trong ref (đồng bộ) + `useReducer` chỉ để vẽ lại: Enter rồi blur
 * trong cùng tick (trước khi React vẽ lại) vẫn thấy `saving` và bị bỏ qua — không gửi đôi. `onSave`/`describeError` đọc qua
 * ref nên luôn dùng bản mới nhất (vd `version` OCC mới sau khi nạp lại).
 */
export function useInlineEdit({
  value,
  onSave,
  onEditStart,
  describeError,
  maxLength,
}: {
  value: string;
  /** `attempt` = số lần lưu lỗi trước đó trong lần sửa này (0 = lần đầu). */
  onSave: (next: string, attempt: number) => Promise<unknown>;
  onEditStart?: () => void;
  describeError: (e: unknown) => string;
  maxLength: number;
}) {
  const stateRef = useRef<InlineEditState>(INLINE_VIEW);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const dispatch = useCallback((a: InlineEditAction) => {
    const next = inlineEditReducer(stateRef.current, a);
    if (next !== stateRef.current) {
      stateRef.current = next;
      rerender();
    }
    return next;
  }, []);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onEditStartRef = useRef(onEditStart);
  onEditStartRef.current = onEditStart;
  const describeRef = useRef(describeError);
  describeRef.current = describeError;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const persist = useCallback(
    async (next: string, attempt: number) => {
      try {
        await onSaveRef.current(next, attempt);
        dispatch({ type: 'saved' });
        setSavedAt(Date.now());
        window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
      } catch (e) {
        dispatch({ type: 'failed', message: describeRef.current(e) });
      }
    },
    [dispatch],
  );
  const submit = useCallback(() => {
    const before = stateRef.current.phase;
    const next = dispatch({ type: 'submit', original: valueRef.current, max: maxLength });
    if (before !== 'saving' && next.phase === 'saving') void persist(next.value, next.attempt);
  }, [dispatch, maxLength, persist]);
  const retry = useCallback(() => {
    const next = dispatch({ type: 'retry' });
    if (next.phase === 'saving') void persist(next.value, next.attempt);
  }, [dispatch, persist]);
  const start = useCallback(() => {
    window.clearTimeout(savedTimer.current);
    setSavedAt(null);
    // Chụp khoá lạc quan NGAY lúc bắt đầu sửa (trước mọi thay đổi xen giữa), chỉ khi thật sự vào chế độ sửa.
    if (stateRef.current.phase === 'view') onEditStartRef.current?.();
    dispatch({ type: 'start', value: valueRef.current });
  }, [dispatch]);
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), [dispatch]);
  const change = useCallback((draft: string) => dispatch({ type: 'change', draft }), [dispatch]);

  return { state: stateRef.current, stateRef, savedAt, submit, retry, start, cancel, change };
}
