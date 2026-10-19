import { describe, expect, it } from 'vitest';
import {
  OTHER_FACTS,
  STRIP_FACTS,
  factLayout,
  otherFactsKey,
  parseOtherOpen,
  readOtherOpen,
  writeOtherOpen,
  type FactStorage,
} from './issueFacts';

function mem(init: Record<string, string> = {}): FactStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
const blocked: FactStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

describe('factLayout — thuộc tính nào nằm ở đâu', () => {
  it('dải chính = Trạng thái, Người phụ trách, Hạn, Ưu tiên (theo thứ tự)', () => {
    expect(STRIP_FACTS).toEqual(['status', 'assignee', 'due', 'priority']);
  });
  it('từ lg trở lên: y như hiện nay — không dải, không "Thuộc tính khác", mọi thứ ở cột phải', () => {
    const l = factLayout(true);
    expect(l.strip).toEqual([]);
    expect(l.other).toEqual([]);
    expect(l.sidebar).toEqual(
      expect.arrayContaining([
        'epicParent',
        'assignee',
        'reporter',
        'participants',
        'startDate',
        'due',
      ]),
    );
    expect(l.statusInToolbar).toBe(true);
    expect(l.priorityInHeader).toBe(true);
  });
  it('dưới lg: dải có 4 trường chính, phần còn lại vào "Thuộc tính khác", cột phải không còn trường nào', () => {
    const l = factLayout(false);
    expect(l.strip).toEqual([...STRIP_FACTS]);
    expect(l.other).toEqual([...OTHER_FACTS]);
    expect(l.sidebar).toEqual([]);
    expect(l.statusInToolbar).toBe(false);
    expect(l.priorityInHeader).toBe(false);
  });
  it('bốn trường của dải không xuất hiện hai lần: rời nhau với "Thuộc tính khác"', () => {
    const l = factLayout(false);
    for (const f of l.strip) expect(l.other).not.toContain(f);
    expect(new Set([...l.strip, ...l.other]).size).toBe(l.strip.length + l.other.length);
  });
  it('mỗi trường ở đúng MỘT nơi trên mỗi cỡ màn hình (mã trường không trùng nơi nào)', () => {
    for (const desktop of [true, false]) {
      const l = factLayout(desktop);
      const all = [...l.strip, ...l.other, ...l.sidebar];
      expect(new Set(all).size).toBe(all.length);
      for (const f of ['assignee', 'due', 'epicParent', 'reporter', 'startDate'] as const)
        expect(all).toContain(f);
    }
  });
  it('"Thuộc tính khác" gồm các trường còn lại của cột phải', () => {
    expect(OTHER_FACTS).toEqual([
      'epicParent',
      'reporter',
      'participants',
      'startDate',
      'createdAt',
      'updatedAt',
      'resolvedAt',
    ]);
  });
});

describe('nhớ trạng thái mở "Thuộc tính khác" theo người dùng', () => {
  it('khoá theo người dùng', () => {
    expect(otherFactsKey('u1')).toBe('tirapro:issueOtherFacts:v1:u1');
    expect(otherFactsKey('u1')).not.toBe(otherFactsKey('u2'));
  });
  it('mặc định thu gọn; chỉ "1" là mở', () => {
    expect(parseOtherOpen(null)).toBe(false);
    expect(parseOtherOpen('')).toBe(false);
    expect(parseOtherOpen('true')).toBe(false);
    expect(parseOtherOpen('1')).toBe(true);
  });
  it('ghi rồi đọc; thu lại thì xoá khoá; người khác không thấy', () => {
    const st = mem();
    writeOtherOpen(otherFactsKey('u1'), true, st);
    expect(readOtherOpen(otherFactsKey('u1'), st)).toBe(true);
    expect(readOtherOpen(otherFactsKey('u2'), st)).toBe(false);
    writeOtherOpen(otherFactsKey('u1'), false, st);
    expect(st.map.has(otherFactsKey('u1'))).toBe(false);
  });
  it('storage ném lỗi / không có khoá: đọc → thu gọn, ghi không ném', () => {
    expect(readOtherOpen('k', blocked)).toBe(false);
    expect(() => writeOtherOpen('k', true, blocked)).not.toThrow();
    expect(readOtherOpen(null, mem())).toBe(false);
    expect(readOtherOpen('k', null)).toBe(false);
  });
});
