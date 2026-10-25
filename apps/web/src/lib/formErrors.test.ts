import { describe, expect, it } from 'vitest';
import {
  describedBy,
  errorCountLabel,
  fieldErrorId,
  invalidAttrs,
  sortByDocumentOrder,
  type FieldError,
} from './formErrors';

describe('errorCountLabel', () => {
  it('đếm theo tiếng Việt, không có số nhiều', () => {
    expect(errorCountLabel(1)).toBe('1 trường cần sửa');
    expect(errorCountLabel(3)).toBe('3 trường cần sửa');
    expect(errorCountLabel(12)).toBe('12 trường cần sửa');
  });
  it('không có lỗi → chuỗi rỗng', () => {
    expect(errorCountLabel(0)).toBe('');
  });
  it('không dùng "(s)"', () => {
    expect(errorCountLabel(2)).not.toMatch(/\(s\)/);
  });
});

describe('fieldErrorId / describedBy', () => {
  it('id lời lỗi ổn định theo id trường', () => {
    expect(fieldErrorId('digest-name')).toBe('digest-name-error');
  });
  it('describedBy nối các id có giá trị bằng dấu cách, bỏ rỗng', () => {
    expect(describedBy('a-hint', undefined, 'a-error')).toBe('a-hint a-error');
    expect(describedBy(undefined, '', null, false)).toBeUndefined();
    expect(describedBy('x')).toBe('x');
  });
});

describe('invalidAttrs', () => {
  it('không lỗi (undefined/false/chuỗi rỗng) → không aria-invalid, giữ describedby cũ', () => {
    for (const inv of [undefined, false, '', '   ']) {
      expect(invalidAttrs(inv, 'f', 'f-hint')).toEqual({
        ariaInvalid: undefined,
        describedBy: 'f-hint',
        errorId: null,
        errorText: null,
      });
    }
  });
  it('invalid=true → aria-invalid, KHÔNG có lời lỗi, giữ describedby cũ', () => {
    expect(invalidAttrs(true, 'f', 'f-hint')).toEqual({
      ariaInvalid: true,
      describedBy: 'f-hint',
      errorId: null,
      errorText: null,
    });
  });
  it('invalid là chuỗi → lời lỗi với id ổn định; describedby = gợi ý cũ + id lỗi (cách nhau dấu cách)', () => {
    expect(invalidAttrs('Vui lòng nhập tên.', 'f', 'f-hint')).toEqual({
      ariaInvalid: true,
      describedBy: 'f-hint f-error',
      errorId: 'f-error',
      errorText: 'Vui lòng nhập tên.',
    });
  });
  it('chuỗi lỗi không có gợi ý cũ → chỉ id lỗi', () => {
    expect(invalidAttrs('Sai', 'f').describedBy).toBe('f-error');
  });
});

describe('sortByDocumentOrder', () => {
  // Phần tử giả: compareDocumentPosition giống DOM (4 = `other` đứng SAU, 2 = đứng TRƯỚC).
  const el = (pos: number) => ({
    pos,
    compareDocumentPosition(o: { pos: number }) {
      return o.pos > pos ? 4 : o.pos < pos ? 2 : 0;
    },
  });
  const E = (id: string): FieldError => ({ id, label: id, message: 'm' });
  const els: Record<string, ReturnType<typeof el> | null> = {
    name: el(10),
    blocks: el(30),
    recipients: el(20),
    hidden: null,
  };
  const elOf = (e: FieldError) => els[e.id] ?? null;

  it('xếp lỗi theo thứ tự ô xuất hiện trong trang, không theo thứ tự báo lỗi', () => {
    const out = sortByDocumentOrder([E('blocks'), E('name'), E('recipients')], elOf);
    expect(out.map((e) => e.id)).toEqual(['name', 'recipients', 'blocks']);
  });
  it('bỏ lỗi không có ô trong trang (ẩn/không vẽ)', () => {
    const out = sortByDocumentOrder([E('hidden'), E('blocks'), E('name')], elOf);
    expect(out.map((e) => e.id)).toEqual(['name', 'blocks']);
  });
  it('không đổi mảng đầu vào; rỗng → rỗng', () => {
    const input = [E('blocks'), E('name')];
    sortByDocumentOrder(input, elOf);
    expect(input.map((e) => e.id)).toEqual(['blocks', 'name']);
    expect(sortByDocumentOrder([], elOf)).toEqual([]);
  });
});
