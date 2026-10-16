import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import {
  applyMention,
  filterMentionCandidates,
  findMentionTrigger,
  type MentionPerson,
  type MentionTrigger,
} from './mentionQuery';

/**
 * Trạng thái popup @ của MarkdownEditor: dấu @ đang gõ dở quanh con trỏ, danh sách gợi ý, dòng đang chọn
 * và xử lý phím. `people` không có → mọi thứ tắt (không gợi ý, không tốn request).
 */
export function useMentionPopup(
  ref: RefObject<HTMLTextAreaElement>,
  people: MentionPerson[] | undefined,
  onChange: (v: string) => void,
  /** Báo từ khoá @ đang gõ (null = không còn gõ @) để nơi gọi tìm người phía máy chủ. */
  onQueryChange?: (query: string | null) => void,
) {
  const listId = useId();
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [active, setActive] = useState(0);
  // Esc đóng popup của đúng dấu @ này; gõ @ khác (hoặc xoá hẳn) thì mở lại bình thường.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const candidates = useMemo(
    () => (trigger && people?.length ? filterMentionCandidates(people, trigger.query) : []),
    [trigger, people],
  );
  const queryNow = trigger?.query ?? null;
  useEffect(() => {
    onQueryChange?.(queryNow);
  }, [queryNow, onQueryChange]);
  const popupOpen = !!trigger && candidates.length > 0 && dismissedAt !== trigger.start;
  const activeIdx = Math.min(active, Math.max(candidates.length - 1, 0));

  /** Tính lại dấu @ đang gõ dở quanh con trỏ (mặc định đọc thẳng từ textarea). */
  function syncTrigger(value?: string, caret?: number) {
    const ta = ref.current;
    if (!people || (!ta && value === undefined)) return;
    const next = findMentionTrigger(value ?? ta!.value, caret ?? ta!.selectionStart);
    if (next?.start !== trigger?.start || next?.query !== trigger?.query) setActive(0);
    setTrigger(next);
    if (!next) setDismissedAt(null);
  }

  function pick(person: MentionPerson) {
    const ta = ref.current;
    if (!ta || !trigger) return;
    const r = applyMention(ta.value, trigger, ta.selectionStart, person);
    onChange(r.value);
    setTrigger(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.caret, r.caret);
    });
  }

  /**
   * Popup mở: nuốt ↑↓/Enter/Tab trước logic ⌘Enter/Esc của editor; bỏ qua khi đang gõ bộ gõ (Telex/VNI).
   * Trả `true` nếu đã xử lý phím.
   */
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!popupOpen || !trigger || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = candidates.length;
      setActive((activeIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      return true;
    }
    if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(candidates[activeIdx]!);
      return true;
    }
    return false;
  }

  // Esc khi popup mở chỉ đóng popup. Phải bắt ở window (capture) vì Dialog Radix nghe Esc ở document (capture)
  // — chặn ở onKeyDown của textarea thì đã muộn, hộp "Tạo công việc" vẫn bị đóng.
  const dismissStart = popupOpen && trigger ? trigger.start : null;
  useEffect(() => {
    if (dismissStart === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation(); // không kích onCancel (huỷ sửa) của editor, không đóng Dialog
      setDismissedAt(dismissStart);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dismissStart]);

  const aria = people
    ? {
        role: 'combobox' as const,
        'aria-autocomplete': 'list' as const,
        'aria-expanded': popupOpen,
        'aria-controls': popupOpen ? listId : undefined,
        'aria-activedescendant': popupOpen ? `${listId}-opt-${activeIdx}` : undefined,
      }
    : {};

  return {
    listId,
    candidates,
    popupOpen,
    activeIdx,
    setActive,
    syncTrigger,
    pick,
    handleKey,
    close: () => setTrigger(null),
    aria,
  };
}
