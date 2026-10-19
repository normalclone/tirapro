import { describe, expect, it } from 'vitest';
import { LABEL_PALETTE } from '@/lib/labelPalette';
import {
  CREATE_VALUE,
  LABEL_NAME_MAX,
  createOffer,
  emptyRows,
  labelKey,
  labelOptions,
  nextLabelColor,
  pendingAnnouncement,
  pinnedRows,
  reducePending,
} from './labelCombo';

const L = (id: string, name: string, color: string | null = null) => ({ id, name, color });
const labels = [L('1', 'backend', '#3263c3'), L('2', 'Cần xem lại', '#017b37'), L('3', 'urgent')];

describe('labelKey — so tên không phân biệt hoa/thường và dấu', () => {
  it('hoa/thường, dấu, đ, khoảng trắng thừa', () => {
    expect(labelKey('Cần Xem Lại')).toBe(labelKey('can xem lai'));
    expect(labelKey('  Đang   làm ')).toBe(labelKey('dang lam'));
    expect(labelKey('ĐÀ NẴNG')).toBe('da nang');
  });
  it('dấu gạch nối là KHÁC khoảng trắng (không gộp "tech-debt" với "tech debt")', () => {
    expect(labelKey('tech-debt')).not.toBe(labelKey('tech debt'));
  });
  it('tổ hợp dấu rời và dựng sẵn như nhau', () => {
    expect(labelKey('é')).toBe(labelKey('é'));
  });
});

describe('createOffer', () => {
  const base = { labels, attachedIds: new Set<string>(), canCreate: true };
  it('ô trống → none', () => {
    expect(createOffer({ ...base, q: '   ' })).toEqual({ kind: 'none' });
  });
  it('chưa có nhãn trùng + có quyền → create với tên đã cắt khoảng trắng', () => {
    expect(createOffer({ ...base, q: '  mới  ' })).toEqual({ kind: 'create', name: 'mới' });
  });
  it('trùng chỉ khác hoa/thường hoặc dấu → exists (KHÔNG tạo trùng), kể cả khi không có quyền', () => {
    for (const q of ['BACKEND', 'can xem lai', 'Cần XEM lại']) {
      for (const canCreate of [true, false]) {
        const o = createOffer({ ...base, q, canCreate });
        expect(o.kind).toBe('exists');
      }
    }
    expect(createOffer({ ...base, q: 'can xem lai' })).toEqual({
      kind: 'exists',
      labelId: '2',
      attached: false,
    });
  });
  it('trùng nhãn ĐÃ gắn → exists attached', () => {
    expect(createOffer({ ...base, attachedIds: new Set(['1']), q: 'Backend' })).toEqual({
      kind: 'exists',
      labelId: '1',
      attached: true,
    });
  });
  it('không có quyền quản trị dự án → noPermission', () => {
    expect(createOffer({ ...base, q: 'mới', canCreate: false })).toEqual({ kind: 'noPermission' });
  });
  it(`tên dài hơn ${LABEL_NAME_MAX} ký tự → tooLong (trước cả kiểm quyền)`, () => {
    const long = 'x'.repeat(LABEL_NAME_MAX + 1);
    expect(createOffer({ ...base, q: long })).toEqual({ kind: 'tooLong' });
    expect(createOffer({ ...base, q: 'x'.repeat(LABEL_NAME_MAX) }).kind).toBe('create');
  });
});

describe('pinnedRows', () => {
  it('create → dòng "Tạo nhãn “X”" chọn được', () => {
    expect(pinnedRows({ kind: 'create', name: 'mới' })).toEqual([
      { value: CREATE_VALUE, label: 'Tạo nhãn “mới”' },
    ]);
  });
  it('noPermission → gợi ý "Nhờ quản trị dự án tạo nhãn" (không chọn được)', () => {
    expect(pinnedRows({ kind: 'noPermission' })).toEqual([
      expect.objectContaining({ label: 'Nhờ quản trị dự án tạo nhãn', disabled: true }),
    ]);
  });
  it('exists đã gắn → báo đã gắn (không chọn được); exists chưa gắn / none → không thêm dòng', () => {
    const r = pinnedRows({ kind: 'exists', labelId: '1', attached: true });
    expect(r).toHaveLength(1);
    expect(r[0]!.disabled).toBe(true);
    expect(pinnedRows({ kind: 'exists', labelId: '1', attached: false })).toEqual([]);
    expect(pinnedRows({ kind: 'none' })).toEqual([]);
  });
  it('tooLong → nêu giới hạn', () => {
    expect(pinnedRows({ kind: 'tooLong' })[0]).toEqual(
      expect.objectContaining({ label: 'Tên nhãn tối đa 50 ký tự', disabled: true }),
    );
  });
});

describe('labelOptions', () => {
  it('chỉ nhãn chưa gắn; màu qua token (không hex thô)', () => {
    const o = labelOptions(labels, new Set(['2']), '');
    expect(o.map((x) => x.value)).toEqual(['1', '3']);
    expect(o[0]!.color).toBe('var(--label-1)');
    expect(o[1]!.color).toBe('var(--label-8)'); // null → Xám
  });
  it('khớp CHÍNH XÁC (không phân biệt hoa/dấu) đứng đầu để Enter chọn đúng nhãn đó', () => {
    const list = [L('a', 'back'), L('b', 'backend'), L('c', 'Back')];
    const o = labelOptions(list, new Set(), 'BACK');
    expect(o[0]!.value).not.toBe('b');
    expect(['a', 'c']).toContain(o[0]!.value);
    expect(
      labelOptions([L('x', 'backend2'), L('y', 'backend')], new Set(), 'Backend')[0]!.value,
    ).toBe('y');
  });
  it('không đổi thứ tự khi không có khớp chính xác', () => {
    expect(labelOptions(labels, new Set(), 'e').map((x) => x.value)).toEqual(['1', '2', '3']);
  });
});

describe('nextLabelColor — màu mặc định của nhãn tạo nhanh', () => {
  it('dự án chưa có nhãn → màu đầu bảng (Xanh dương)', () => {
    expect(nextLabelColor([])).toBe(LABEL_PALETTE[0]!.hex);
  });
  it('lấy màu CHƯA dùng đầu tiên của bảng, so không phân biệt hoa/thường', () => {
    const used = [
      L('1', 'a', LABEL_PALETTE[0]!.hex.toUpperCase()),
      L('2', 'b', LABEL_PALETTE[1]!.hex),
    ];
    expect(nextLabelColor(used)).toBe(LABEL_PALETTE[2]!.hex);
  });
  it('màu cũ ngoài bảng không "ăn" màu của bảng', () => {
    expect(nextLabelColor([L('1', 'a', '#2563eb'), L('2', 'b', null)])).toBe(LABEL_PALETTE[0]!.hex);
  });
  it('dùng hết 8 màu → quay vòng theo số nhãn', () => {
    const all = LABEL_PALETTE.map((e, i) => L(String(i), `n${i}`, e.hex));
    expect(nextLabelColor(all)).toBe(LABEL_PALETTE[0]!.hex);
    expect(nextLabelColor([...all, L('9', 'x', LABEL_PALETTE[0]!.hex)])).toBe(
      LABEL_PALETTE[1]!.hex,
    );
  });
});

describe('reducePending — Backspace hai lần gỡ chip cuối', () => {
  const chips = ['a', 'b', 'c'];
  const none = { pendingId: null };
  it('Backspace #1 ở ô trống: đánh dấu chip cuối, chưa gỡ', () => {
    const r = reducePending(none, { type: 'backspace', query: '', chipIds: chips });
    expect(r.state).toEqual({ pendingId: 'c' });
    expect(r.remove).toBeNull();
    expect(r.handled).toBe(true);
  });
  it('Backspace #2: gỡ đúng chip đang chờ và xoá trạng thái chờ', () => {
    const r = reducePending({ pendingId: 'c' }, { type: 'backspace', query: '', chipIds: chips });
    expect(r.remove).toBe('c');
    expect(r.state).toEqual(none);
    expect(r.handled).toBe(true);
  });
  it('phím khác / gõ chữ / đóng popup xoá trạng thái chờ', () => {
    for (const a of [
      { type: 'key', key: 'ArrowDown' },
      { type: 'key', key: 'Enter' },
      { type: 'key', key: 'a' },
      { type: 'input' },
      { type: 'close' },
    ] as const) {
      const r = reducePending({ pendingId: 'c' }, a);
      expect(r.state).toEqual(none);
      expect(r.remove).toBeNull();
    }
  });
  it('phím bổ trợ đơn lẻ (Shift/Ctrl/Alt/Meta) KHÔNG xoá', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
      expect(reducePending({ pendingId: 'c' }, { type: 'key', key }).state).toEqual({
        pendingId: 'c',
      });
    }
  });
  it('ô có chữ: Backspace là xoá chữ — không đánh dấu, không gỡ, và xoá trạng thái chờ', () => {
    const r = reducePending({ pendingId: 'c' }, { type: 'backspace', query: 'ab', chipIds: chips });
    expect(r.state).toEqual(none);
    expect(r.remove).toBeNull();
    expect(r.handled).toBe(false);
  });
  it('không có chip nào: Backspace không làm gì', () => {
    const r = reducePending(none, { type: 'backspace', query: '', chipIds: [] });
    expect(r).toEqual({ state: none, remove: null, handled: false });
  });
  it('chip đang chờ biến mất (gỡ từ nơi khác) → xoá chờ; Backspace sau đó đánh dấu chip cuối MỚI', () => {
    expect(reducePending({ pendingId: 'c' }, { type: 'chips', chipIds: ['a', 'b'] }).state).toEqual(
      none,
    );
    expect(reducePending({ pendingId: 'c' }, { type: 'chips', chipIds: chips }).state).toEqual({
      pendingId: 'c',
    });
    const r = reducePending(
      { pendingId: 'c' },
      { type: 'backspace', query: '', chipIds: ['a', 'b'] },
    );
    expect(r.state).toEqual({ pendingId: 'b' });
    expect(r.remove).toBeNull();
  });
  it('lời báo cho trình đọc màn hình nêu tên nhãn và phím', () => {
    expect(pendingAnnouncement('backend')).toBe('Nhấn Backspace lần nữa để gỡ nhãn backend');
  });
});

describe('emptyRows', () => {
  it('còn nhãn chưa gắn → không có dòng', () => expect(emptyRows(3, 1, true)).toEqual([]));
  it('dự án chưa có nhãn / đã gắn hết', () => {
    expect(emptyRows(0, 0, false)[0]!.label).toBe('Dự án chưa có nhãn nào.');
    expect(emptyRows(3, 0, false)[0]!.label).toBe('Đã gắn hết nhãn.');
  });
  it('người có quyền được mời gõ tên để tạo; dòng không chọn được', () => {
    const r = emptyRows(0, 0, true)[0]!;
    expect(r.label).toBe('Dự án chưa có nhãn nào. Gõ tên để tạo nhãn mới.');
    expect(r.disabled).toBe(true);
  });
});
