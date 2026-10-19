import { describe, expect, it } from 'vitest';
import {
  INLINE_VIEW,
  inlineEditReducer,
  inlineKeyAction,
  inlineStatus,
  type InlineEditAction,
  type InlineEditState,
} from './inlineEdit';

const run = (s: InlineEditState, ...a: InlineEditAction[]) => a.reduce(inlineEditReducer, s);
const editing = (draft: string, attempt = 0): InlineEditState => ({
  phase: 'editing',
  draft,
  invalid: null,
  attempt,
});
const submit = (original = 'Cũ'): InlineEditAction => ({ type: 'submit', original });

describe('inlineEditReducer — view → editing', () => {
  it('start: view → editing với bản nháp = giá trị gốc', () => {
    expect(run(INLINE_VIEW, { type: 'start', value: 'Cũ' })).toEqual(editing('Cũ'));
  });
  it('start khi đang sửa/lưu/lỗi: bỏ qua (không ghi đè bản nháp)', () => {
    for (const s of [
      editing('đang gõ'),
      { phase: 'saving', draft: 'x', value: 'x', attempt: 0 } as const,
      { phase: 'error', draft: 'x', value: 'x', message: 'm', attempt: 1 } as const,
    ])
      expect(run(s, { type: 'start', value: 'Cũ' })).toBe(s);
  });
  it('change chỉ có tác dụng khi đang sửa / lỗi; xoá cờ lỗi nhập', () => {
    expect(run(editing('a'), { type: 'change', draft: 'ab' })).toEqual(editing('ab'));
    const bad: InlineEditState = { phase: 'editing', draft: '', invalid: 'empty', attempt: 0 };
    expect(run(bad, { type: 'change', draft: 'x' })).toEqual(editing('x'));
    const err: InlineEditState = {
      phase: 'error',
      draft: 'a',
      value: 'a',
      message: 'm',
      attempt: 1,
    };
    expect(run(err, { type: 'change', draft: 'b' })).toEqual(editing('b', 1)); // đếm lần lỗi giữ nguyên qua lúc sửa
    expect(run(INLINE_VIEW, { type: 'change', draft: 'x' })).toBe(INLINE_VIEW);
    const saving: InlineEditState = { phase: 'saving', draft: 'a', value: 'a', attempt: 0 };
    expect(run(saving, { type: 'change', draft: 'b' })).toBe(saving);
  });
});

describe('inlineEditReducer — submit', () => {
  it('giá trị mới (đã trim) → saving, gửi bản đã trim', () => {
    expect(run(editing('  Mới  '), submit())).toEqual({
      phase: 'saving',
      draft: '  Mới  ',
      value: 'Mới',
      attempt: 0,
    });
  });
  it('không đổi sau khi trim → về view, KHÔNG gửi (không sang saving)', () => {
    expect(run(editing('  Cũ '), submit())).toEqual(INLINE_VIEW);
    expect(run(editing('Cũ'), submit())).toEqual(INLINE_VIEW);
  });
  it('rỗng / chỉ khoảng trắng → vẫn sửa, có lỗi `empty`, không gửi', () => {
    expect(run(editing(''), submit())).toEqual({
      phase: 'editing',
      draft: '',
      invalid: 'empty',
      attempt: 0,
    });
    expect(run(editing('   '), submit())).toEqual({
      phase: 'editing',
      draft: '   ',
      invalid: 'empty',
      attempt: 0,
    });
  });
  it('quá dài (max) → lỗi `tooLong`, không gửi; đủ dài vẫn gửi', () => {
    const long = 'a'.repeat(256);
    expect(run(editing(long), { type: 'submit', original: 'Cũ', max: 255 })).toEqual({
      phase: 'editing',
      draft: long,
      invalid: 'tooLong',
      attempt: 0,
    });
    expect(run(editing('a'.repeat(255)), { type: 'submit', original: 'Cũ', max: 255 }).phase).toBe(
      'saving',
    );
  });
  it('KHÔNG GỬI ĐÔI: submit khi đang saving bị bỏ qua (Enter rồi blur)', () => {
    const s1 = run(editing('Mới'), submit());
    expect(s1.phase).toBe('saving');
    expect(run(s1, submit())).toBe(s1);
  });
  it('submit khi view bị bỏ qua (blur sau khi đã lưu/huỷ)', () => {
    expect(run(INLINE_VIEW, submit())).toBe(INLINE_VIEW);
  });
  it('submit từ trạng thái lỗi: gửi bản nháp hiện tại; đã sửa về gốc → view', () => {
    const err: InlineEditState = {
      phase: 'error',
      draft: 'Mới',
      value: 'Mới',
      message: 'm',
      attempt: 1,
    };
    expect(run(err, submit())).toEqual({ phase: 'saving', draft: 'Mới', value: 'Mới', attempt: 1 });
    expect(run({ ...err, draft: 'Cũ' }, submit())).toEqual(INLINE_VIEW);
  });
});

describe('inlineEditReducer — kết quả lưu, huỷ, thử lại', () => {
  const saving: InlineEditState = { phase: 'saving', draft: 'Mới', value: 'Mới', attempt: 0 };
  it('saved: saving → view; ngoài saving bỏ qua', () => {
    expect(run(saving, { type: 'saved' })).toEqual(INLINE_VIEW);
    expect(run(editing('x'), { type: 'saved' })).toEqual(editing('x'));
  });
  it('failed: saving → error giữ nguyên bản nháp + giá trị đã gửi + lời lỗi', () => {
    expect(run(saving, { type: 'failed', message: 'Mất mạng' })).toEqual({
      phase: 'error',
      draft: 'Mới',
      value: 'Mới',
      message: 'Mất mạng',
      attempt: 1,
    });
    expect(run(editing('x'), { type: 'failed', message: 'm' })).toEqual(editing('x'));
  });
  it('cancel: sửa/lỗi → view (bỏ bản nháp); đang saving không huỷ được', () => {
    expect(run(editing('x'), { type: 'cancel' })).toEqual(INLINE_VIEW);
    expect(
      run({ phase: 'error', draft: 'x', value: 'x', message: 'm', attempt: 1 }, { type: 'cancel' }),
    ).toEqual(INLINE_VIEW);
    expect(run(saving, { type: 'cancel' })).toBe(saving);
  });
  it('retry: error → saving với GIÁ TRỊ GỬI LẦN CUỐI (kể cả khi chưa sửa gì); ngoài error bỏ qua', () => {
    const err: InlineEditState = {
      phase: 'error',
      draft: 'Mới',
      value: 'Mới',
      message: 'm',
      attempt: 1,
    };
    expect(run(err, { type: 'retry' })).toEqual({
      phase: 'saving',
      draft: 'Mới',
      value: 'Mới',
      attempt: 1,
    });
    expect(run(editing('x'), { type: 'retry' })).toEqual(editing('x'));
  });
  it('vòng đời đầy đủ: start → change → submit → failed → retry → saved', () => {
    const s = run(
      INLINE_VIEW,
      { type: 'start', value: 'Cũ' },
      { type: 'change', draft: 'Mới' },
      submit(),
      { type: 'failed', message: 'x' },
      { type: 'retry' },
      { type: 'saved' },
    );
    expect(s).toEqual(INLINE_VIEW);
  });
});

describe('attempt — số lần lưu LỖI trong một lần sửa (lần đầu dùng version lúc mở ô, sau lỗi dùng version mới nhất)', () => {
  it('lần lưu đầu của một lần sửa: attempt 0', () => {
    expect(run(editing('Mới'), submit())).toMatchObject({ phase: 'saving', attempt: 0 });
  });
  it('lỗi → error.attempt = 1; Thử lại / ✓ / Enter sau lỗi → saving.attempt = 1 (KHÔNG phải lần đầu)', () => {
    const failed = run(editing('Mới'), submit(), { type: 'failed', message: 'x' });
    expect(failed).toMatchObject({ phase: 'error', attempt: 1 });
    expect(run(failed, { type: 'retry' })).toMatchObject({ phase: 'saving', attempt: 1 });
    expect(run(failed, submit())).toMatchObject({ phase: 'saving', attempt: 1 });
  });
  it('sửa chữ sau lỗi rồi lưu: vẫn KHÔNG phải lần đầu (không quay lại version cũ rồi 409 mãi)', () => {
    const failed = run(editing('Mới'), submit(), { type: 'failed', message: 'x' });
    const again = run(failed, { type: 'change', draft: 'Mới hơn' }, submit());
    expect(again).toMatchObject({ phase: 'saving', attempt: 1, value: 'Mới hơn' });
  });
  it('lỗi liên tiếp tăng dần; huỷ rồi mở lại là lần sửa mới (attempt 0)', () => {
    const second = run(
      editing('Mới'),
      submit(),
      { type: 'failed', message: 'a' },
      { type: 'retry' },
      { type: 'failed', message: 'b' },
    );
    expect(second).toMatchObject({ phase: 'error', attempt: 2 });
    const fresh = run(second, { type: 'cancel' }, { type: 'start', value: 'Cũ' });
    expect(fresh).toEqual(editing('Cũ', 0));
  });
});

describe('inlineKeyAction — Enter / Esc, an toàn với bộ gõ', () => {
  const k = (o: Partial<Parameters<typeof inlineKeyAction>[0]>) =>
    inlineKeyAction({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      justComposed: false,
      ...o,
    });
  it('Enter thường → lưu', () => expect(k({})).toBe('save'));
  it('Enter khi bộ gõ đang soạn (isComposing / keyCode 229 / vừa chốt chữ) → không làm gì', () => {
    expect(k({ isComposing: true })).toBe('none');
    expect(k({ keyCode: 229 })).toBe('none');
    expect(k({ justComposed: true })).toBe('none');
  });
  it('Shift+Enter: tiêu đề một dòng → chặn (không lưu, không xuống dòng)', () => {
    expect(k({ shiftKey: true })).toBe('swallow');
  });
  it('Esc → huỷ; Esc khi đang soạn thuộc về bộ gõ → không làm gì', () => {
    expect(k({ key: 'Escape' })).toBe('cancel');
    expect(k({ key: 'Escape', isComposing: true })).toBe('none');
  });
  it('phím khác → không làm gì', () => {
    expect(k({ key: 'a' })).toBe('none');
    expect(k({ key: 'Tab' })).toBe('none');
  });
});

describe('inlineStatus — SaveStatus', () => {
  it('saving → saving, error → error', () => {
    expect(inlineStatus({ phase: 'saving', draft: 'a', value: 'a', attempt: 0 }, null)).toEqual({
      state: 'saving',
    });
    expect(
      inlineStatus({ phase: 'error', draft: 'a', value: 'a', message: 'm', attempt: 1 }, null),
    ).toEqual({
      state: 'error',
    });
  });
  it('view có mốc lưu → saved; không có → idle; đang sửa → idle', () => {
    expect(inlineStatus(INLINE_VIEW, 1700000000000)).toEqual({ state: 'saved', at: 1700000000000 });
    expect(inlineStatus(INLINE_VIEW, null)).toEqual({ state: 'idle' });
    expect(inlineStatus(editing('a'), 1700000000000)).toEqual({ state: 'idle' });
  });
});
