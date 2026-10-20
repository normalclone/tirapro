import { describe, expect, it } from 'vitest';
import { sourceChips, sourceClickAction } from './aiSources';

const src = (n: number, summary = `Tiêu đề ${n}`) => ({
  issueId: `id${n}`,
  key: `TP-${n}`,
  summary,
});

describe('sourceChips', () => {
  it('đánh số từ 1, nhãn "[n] KEY — tiêu đề", link thật tới /issue/KEY, tên truy cập = nhãn (có mã + tiêu đề)', () => {
    const chips = sourceChips([src(5), src(2)]);
    expect(chips).toEqual([
      {
        n: 1,
        key: 'TP-5',
        summary: 'Tiêu đề 5',
        href: '/issue/TP-5',
        label: '[1] TP-5 — Tiêu đề 5',
      },
      {
        n: 2,
        key: 'TP-2',
        summary: 'Tiêu đề 2',
        href: '/issue/TP-2',
        label: '[2] TP-2 — Tiêu đề 2',
      },
    ]);
  });
  it('tối đa 3 chip, bỏ trùng mã (giữ lần đầu, số vẫn liên tục)', () => {
    const chips = sourceChips([src(1), src(1), src(2), src(3), src(4)]);
    expect(chips.map((c) => c.key)).toEqual(['TP-1', 'TP-2', 'TP-3']);
    expect(chips.map((c) => c.n)).toEqual([1, 2, 3]);
  });
  it('không có nguồn / undefined (máy chủ cũ) → rỗng', () => {
    expect(sourceChips(undefined)).toEqual([]);
    expect(sourceChips([])).toEqual([]);
  });
  it('mã có ký tự lạ được mã hoá trong đường dẫn; tiêu đề rỗng vẫn có nhãn dùng được', () => {
    expect(sourceChips([{ issueId: 'x', key: 'A/B 1', summary: '' }])[0]).toMatchObject({
      href: '/issue/A%2FB%201',
      label: '[1] A/B 1',
    });
  });
  it('tiêu đề nhiều dòng/khoảng trắng thừa được gọn về một dòng', () => {
    expect(sourceChips([src(1, '  Hai\n dòng   ')])[0]!.label).toBe('[1] TP-1 — Hai dòng');
  });
});

describe('sourceClickAction (mẫu Task 13)', () => {
  const plain = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };
  it('bấm thường + có xem nhanh → peek', () => {
    expect(sourceClickAction(plain, true)).toBe('peek');
  });
  it('Cmd/Ctrl/Shift/Alt hoặc chuột giữa → để trình duyệt mở (tab mới)', () => {
    for (const m of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ])
      expect(sourceClickAction({ ...plain, ...m }, true)).toBe('native');
  });
  it('không có xem nhanh ở màn này → điều hướng thường', () => {
    expect(sourceClickAction(plain, false)).toBe('native');
  });
});
