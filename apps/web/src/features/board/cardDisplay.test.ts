import { describe, expect, it } from 'vitest';
import {
  CARD_FIELDS,
  DEFAULT_CARD_DISPLAY,
  cardDisplayKey,
  cardLayout,
  isDefaultDisplay,
  parseCardDisplay,
  readCardDisplay,
  serializeCardDisplay,
  setDensity,
  toggleField,
  writeCardDisplay,
  type CardDisplayStorage,
} from './cardDisplay';

function memStorage(init: Record<string, string> = {}): CardDisplayStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
const throwing: CardDisplayStorage = {
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

describe('mặc định = giao diện hiện nay', () => {
  it('mật độ thường, mọi trường bật', () => {
    expect(DEFAULT_CARD_DISPLAY.density).toBe('normal');
    expect(CARD_FIELDS.map((f) => f.id)).toEqual([
      'assignee',
      'points',
      'labels',
      'priority',
      'progress',
    ]);
    for (const f of CARD_FIELDS) expect(DEFAULT_CARD_DISPLAY.fields[f.id]).toBe(true);
    expect(isDefaultDisplay(DEFAULT_CARD_DISPLAY)).toBe(true);
  });
  it('cardLayout thường giữ nguyên các class của thẻ trước khi có tuỳ chọn', () => {
    expect(cardLayout('normal')).toEqual({
      pad: 'p-2.5',
      gap: 'mb-1.5',
      title: 'line-clamp-2',
      progressTop: 'mt-2',
      labelMax: 3,
    });
  });
  it('cardLayout gọn: đệm/khoảng cách nhỏ hơn (token), tiêu đề 1 dòng, ít nhãn hơn', () => {
    expect(cardLayout('compact')).toEqual({
      pad: 'p-2',
      gap: 'mb-1',
      title: 'line-clamp-1',
      progressTop: 'mt-1.5',
      labelMax: 2,
    });
  });
});

describe('parseCardDisplay', () => {
  it('thiếu/rỗng → mặc định (cùng tham chiếu để context ổn định)', () => {
    expect(parseCardDisplay(null)).toBe(DEFAULT_CARD_DISPLAY);
    expect(parseCardDisplay('')).toBe(DEFAULT_CARD_DISPLAY);
  });
  it('JSON hỏng hoặc sai kiểu → mặc định', () => {
    for (const raw of ['{', 'null', '[]', '123', '"x"', 'true', '{"v":1,"fields":[]}']) {
      expect(parseCardDisplay(raw)).toBe(DEFAULT_CARD_DISPLAY);
    }
  });
  it('đọc mật độ + trường đã tắt; trường không nhắc tới lấy mặc định (trường mới tự được gộp)', () => {
    const d = parseCardDisplay('{"v":1,"density":"compact","fields":{"points":false}}');
    expect(d.density).toBe('compact');
    expect(d.fields.points).toBe(false);
    for (const f of CARD_FIELDS.filter((x) => x.id !== 'points')) expect(d.fields[f.id]).toBe(true);
  });
  it('mật độ lạ → thường; trường lạ bị bỏ; giá trị không phải boolean → mặc định của trường đó', () => {
    const d = parseCardDisplay(
      '{"v":1,"density":"tiny","fields":{"foo":false,"labels":"no","points":false}}',
    );
    expect(d.density).toBe('normal');
    expect(d.fields.labels).toBe(true);
    expect(d.fields.points).toBe(false);
    expect(Object.keys(d.fields).sort()).toEqual(CARD_FIELDS.map((f) => f.id).sort());
  });
  it('kết quả bằng mặc định thì trả đúng tham chiếu mặc định', () => {
    expect(parseCardDisplay('{"v":1,"density":"normal","fields":{"points":true}}')).toBe(
      DEFAULT_CARD_DISPLAY,
    );
  });
});

describe('setDensity / toggleField', () => {
  it('đổi mật độ, không đụng trường', () => {
    const d = setDensity(DEFAULT_CARD_DISPLAY, 'compact');
    expect(d.density).toBe('compact');
    expect(d.fields).toEqual(DEFAULT_CARD_DISPLAY.fields);
    expect(isDefaultDisplay(d)).toBe(false);
  });
  it('đặt lại cùng mật độ → trả nguyên đối tượng (không vẽ lại)', () => {
    expect(setDensity(DEFAULT_CARD_DISPLAY, 'normal')).toBe(DEFAULT_CARD_DISPLAY);
  });
  it('bật/tắt một trường, không sửa đối tượng cũ', () => {
    const off = toggleField(DEFAULT_CARD_DISPLAY, 'points');
    expect(off.fields.points).toBe(false);
    expect(DEFAULT_CARD_DISPLAY.fields.points).toBe(true);
    expect(toggleField(off, 'points')).toEqual(DEFAULT_CARD_DISPLAY);
    expect(isDefaultDisplay(toggleField(off, 'points'))).toBe(true);
  });
  it('Hạn không phải trường tắt được (thẻ chỉ hiện hạn như cảnh báo): due đã lưu từ bản trước bị bỏ như trường lạ', () => {
    expect(CARD_FIELDS.map((f) => f.id as string)).not.toContain('due');
    expect(parseCardDisplay('{"v":1,"density":"normal","fields":{"due":false}}')).toBe(
      DEFAULT_CARD_DISPLAY,
    );
    const d = parseCardDisplay('{"v":1,"density":"compact","fields":{"due":false,"labels":false}}');
    expect(d.density).toBe('compact');
    expect(d.fields.labels).toBe(false);
    expect(Object.keys(d.fields)).not.toContain('due');
    expect(serializeCardDisplay(d)).not.toContain('due');
  });
  it('mã việc và tiêu đề không phải trường tắt được', () => {
    const ids = CARD_FIELDS.map((f) => f.id as string);
    expect(ids).not.toContain('key');
    expect(ids).not.toContain('summary');
  });
});

describe('serialize / lưu theo người + bảng', () => {
  it('khoá theo người dùng và bảng', () => {
    expect(cardDisplayKey('u1', 'b1')).toBe('tirapro:boardDisplay:v1:u1:b1');
    expect(cardDisplayKey('u1', 'b1')).not.toBe(cardDisplayKey('u2', 'b1'));
    expect(cardDisplayKey('u1', 'b1')).not.toBe(cardDisplayKey('u1', 'b2'));
  });
  it('mặc định → null (xoá khoá); chỉ lưu phần khác mặc định', () => {
    expect(serializeCardDisplay(DEFAULT_CARD_DISPLAY)).toBeNull();
    const d = toggleField(setDensity(DEFAULT_CARD_DISPLAY, 'compact'), 'points');
    expect(JSON.parse(serializeCardDisplay(d)!)).toEqual({
      v: 1,
      density: 'compact',
      fields: { points: false },
    });
  });
  it('ghi rồi đọc lại giữ nguyên; đặt lại mặc định xoá khoá', () => {
    const st = memStorage();
    const key = cardDisplayKey('u1', 'b1');
    const d = toggleField(setDensity(DEFAULT_CARD_DISPLAY, 'compact'), 'labels');
    writeCardDisplay(key, d, st);
    expect(readCardDisplay(key, st)).toEqual(d);
    // người khác / bảng khác không thấy
    expect(readCardDisplay(cardDisplayKey('u2', 'b1'), st)).toBe(DEFAULT_CARD_DISPLAY);
    writeCardDisplay(key, DEFAULT_CARD_DISPLAY, st);
    expect(st.map.has(key)).toBe(false);
    expect(readCardDisplay(key, st)).toBe(DEFAULT_CARD_DISPLAY);
  });
  it('storage ném lỗi: đọc → mặc định, ghi không ném', () => {
    expect(readCardDisplay('k', throwing)).toBe(DEFAULT_CARD_DISPLAY);
    expect(() =>
      writeCardDisplay('k', setDensity(DEFAULT_CARD_DISPLAY, 'compact'), throwing),
    ).not.toThrow();
    expect(readCardDisplay('k', null)).toBe(DEFAULT_CARD_DISPLAY);
  });
});
