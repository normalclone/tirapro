import { shouldSubmitOnEnter } from './confirmText';
import type { SaveStatusState } from './saveStatus';

/**
 * `attempt` = số lần lưu LỖI trong lần sửa này (0 = chưa lỗi lần nào → lần lưu đầu). Lần đầu nên dùng khoá lạc quan chụp lúc
 * mở ô (thay đổi xen giữa → 409 thay vì bị ghi đè); sau lỗi người dùng đã thấy xung đột nên "Thử lại"/✓ dùng bản mới nhất.
 *
 * Máy trạng thái sửa tại chỗ một dòng chữ (tiêu đề công việc): xem → sửa → đang lưu → (lỗi → thử lại) → xem.
 * Hàm THUẦN (test được); `InlineText` giữ trạng thái trong `useRef` đồng bộ để Enter rồi blur liền nhau
 * (cùng một tick, trước khi React vẽ lại) vẫn thấy `saving` và bị bỏ qua — không gửi đôi.
 */
type InlineInvalid = 'empty' | 'tooLong';

export type InlineEditState =
  | { phase: 'view' }
  | { phase: 'editing'; draft: string; invalid: InlineInvalid | null; attempt: number }
  | { phase: 'saving'; draft: string; value: string; attempt: number }
  | { phase: 'error'; draft: string; value: string; message: string; attempt: number };

export type InlineEditAction =
  | { type: 'start'; value: string }
  | { type: 'change'; draft: string }
  | { type: 'submit'; original: string; max?: number }
  | { type: 'cancel' }
  | { type: 'saved' }
  | { type: 'failed'; message: string }
  | { type: 'retry' };

export const INLINE_VIEW: InlineEditState = { phase: 'view' };

/** Không đổi được → trả NGUYÊN tham chiếu (bỏ qua). */
export function inlineEditReducer(s: InlineEditState, a: InlineEditAction): InlineEditState {
  switch (a.type) {
    case 'start':
      return s.phase === 'view'
        ? { phase: 'editing', draft: a.value, invalid: null, attempt: 0 }
        : s;
    case 'change':
      return s.phase === 'editing' || s.phase === 'error'
        ? { phase: 'editing', draft: a.draft, invalid: null, attempt: s.attempt }
        : s;
    case 'submit': {
      if (s.phase !== 'editing' && s.phase !== 'error') return s; // view/saving: Enter rồi blur, blur sau khi đã xong
      const value = s.draft.trim();
      if (value === a.original) return INLINE_VIEW; // không đổi: không gửi
      if (value === '')
        return { phase: 'editing', draft: s.draft, invalid: 'empty', attempt: s.attempt };
      if (a.max !== undefined && value.length > a.max)
        return { phase: 'editing', draft: s.draft, invalid: 'tooLong', attempt: s.attempt };
      return { phase: 'saving', draft: s.draft, value, attempt: s.attempt };
    }
    case 'cancel':
      return s.phase === 'editing' || s.phase === 'error' ? INLINE_VIEW : s; // đang lưu: không huỷ được
    case 'saved':
      return s.phase === 'saving' ? INLINE_VIEW : s;
    case 'failed':
      return s.phase === 'saving'
        ? {
            phase: 'error',
            draft: s.draft,
            value: s.value,
            message: a.message,
            attempt: s.attempt + 1,
          }
        : s;
    case 'retry':
      return s.phase === 'error'
        ? { phase: 'saving', draft: s.draft, value: s.value, attempt: s.attempt }
        : s;
  }
}

/**
 * Phím trong ô sửa: `save` (Enter thường, KHÔNG khi bộ gõ đang soạn — dùng chung `shouldSubmitOnEnter` với ô gõ để xác nhận),
 * `swallow` (Shift+Enter: một dòng, không lưu không xuống dòng), `cancel` (Esc; khi đang soạn thì Esc thuộc về bộ gõ),
 * `none` (để phím đi tiếp).
 */
export function inlineKeyAction(e: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  justComposed: boolean;
}): 'save' | 'swallow' | 'cancel' | 'none' {
  if (e.key === 'Escape') return e.isComposing ? 'none' : 'cancel';
  if (e.key !== 'Enter') return 'none';
  if (e.shiftKey) return 'swallow';
  return shouldSubmitOnEnter({ ...e, matches: true }) ? 'save' : 'none';
}

/** Trạng thái cho `SaveStatus`: lưu/lỗi theo máy trạng thái; "Đã lưu" khi đang xem và có mốc lưu gần đây. */
export function inlineStatus(s: InlineEditState, savedAt: number | null): SaveStatusState {
  if (s.phase === 'saving') return { state: 'saving' };
  if (s.phase === 'error') return { state: 'error' };
  if (s.phase === 'view' && savedAt !== null) return { state: 'saved', at: savedAt };
  return { state: 'idle' };
}
