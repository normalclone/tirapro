import { describe, expect, it } from 'vitest';
import {
  changedTokenFields,
  parseDue,
  parseTitleTokens,
  resolveCreateValues,
  shouldAcceptSuggestionOnKey,
  stripPartialTail,
  suggestFor,
  tokenSegments,
  unmatchedHint,
  unmatchedTokens,
  type TokenCtx,
} from './titleTokens';

const ctx: TokenCtx = {
  priorities: [
    { id: 'p5', name: 'Highest', rank: 5 },
    { id: 'p4', name: 'High', rank: 4 },
    { id: 'p3', name: 'Medium', rank: 3, isDefault: true },
    { id: 'p2', name: 'Low', rank: 2 },
    { id: 'p1', name: 'Lowest', rank: 1 },
  ],
  users: [
    { id: 'u1', displayName: 'Bình (BA)' },
    { id: 'u2', displayName: 'Đức' },
  ],
  sprints: [{ id: 's1', name: 'Sprint 3 — QT', state: 'FUTURE' }],
};
const prio = (t: string) => parseTitleTokens(t, ctx).priorityId;

describe('bí danh ưu tiên tiếng Việt', () => {
  it.each([
    ['!khẩn', 'p5'],
    ['!khan', 'p5'],
    ['!khẩn cấp', 'p5'],
    ['!rất cao', 'p5'],
    ['!cao', 'p4'],
    ['!CAO', 'p4'],
    ['!trung bình', 'p3'],
    ['!trung binh', 'p3'],
    ['!tb', 'p3'],
    ['!thấp', 'p2'],
    ['!thap', 'p2'],
    ['!rất thấp', 'p1'],
    ['!rat thap', 'p1'],
  ])('%s => %s', (tok, id) => expect(prio(`Việc A ${tok}`)).toBe(id));
  it('tên tiếng Anh vẫn đúng: !high là High (không phải Highest), !highest là Highest', () => {
    expect(prio('A !high')).toBe('p4');
    expect(prio('A !highest')).toBe('p5');
  });
  it('bí danh dài thắng bí danh ngắn và phần còn lại của tiêu đề được giữ', () => {
    const r = parseTitleTokens('Đăng ký tài khoản !rất thấp ~5', ctx);
    expect(r).toMatchObject({ priorityId: 'p1', points: 5, clean: 'Đăng ký tài khoản' });
  });
  it('bí danh phải đứng trọn từ: "!caoxyz" không khớp bí danh "cao"', () =>
    expect(prio('A !caoxyz')).toBeUndefined());
  it('tập mức tuỳ chỉnh không có tên quen thuộc: 5 mức theo rank; ít hơn 5 mức thì không đoán', () => {
    const five = {
      ...ctx,
      priorities: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
        id: `x${i}`,
        name: n,
        rank: 5 - i,
        isDefault: i === 2,
      })),
    };
    expect(parseTitleTokens('t !khẩn', five).priorityId).toBe('x0');
    expect(parseTitleTokens('t !thấp', five).priorityId).toBe('x3');
    expect(parseTitleTokens('t !tb', five).priorityId).toBe('x2');
    const three = { ...ctx, priorities: five.priorities.slice(0, 3) };
    expect(parseTitleTokens('t !khẩn', three).priorityId).toBeUndefined();
  });
});

describe('normalize: Đ hoa', () => {
  it('@duc khớp "Đức"', () => expect(parseTitleTokens('Việc @duc', ctx).assigneeId).toBe('u2'));
});

describe('unmatchedTokens', () => {
  it('liệt kê token không khớp theo loại', () => {
    const u = unmatchedTokens('Việc !xyz ~abc ^zzz @nobody #nope', ctx);
    expect(u.map((t) => [t.kind, t.text])).toEqual([
      ['priority', '!xyz'],
      ['points', '~abc'],
      ['due', '^zzz'],
      ['assignee', '@nobody'],
      ['sprint', '#nope'],
    ]);
  });
  it('token khớp / tham chiếu #123 / ký hiệu lẻ không bị báo', () => {
    expect(unmatchedTokens('Sửa #123 !cao ~5 ^mai @Bình (BA) và ! lẻ', ctx)).toEqual([]);
  });
  it('skipTail: token đang gõ dở ở cuối không bị báo', () => {
    expect(unmatchedTokens('Việc !xy', ctx, { skipTail: true })).toEqual([]);
    expect(unmatchedTokens('Việc !xy', ctx)).toHaveLength(1);
    expect(unmatchedTokens('Việc !xy tiếp', ctx, { skipTail: true })).toHaveLength(1); // đã có chữ sau => không còn là đuôi
  });
});

describe('stripPartialTail / changedTokenFields', () => {
  it('bỏ từ token dở ở cuối, giữ phần còn lại', () => {
    expect(stripPartialTail('Việc A !ca')).toBe('Việc A');
    expect(stripPartialTail('Việc A !cao ')).toBe('Việc A !cao ');
    expect(stripPartialTail('Việc A')).toBe('Việc A');
    expect(stripPartialTail('~5')).toBe('');
  });
  it('chỉ báo trường có giá trị token mới khác lần trước', () => {
    expect(
      changedTokenFields({ clean: 'a', points: 3 }, { clean: 'a', points: 3, priorityId: 'p4' }),
    ).toEqual({ priorityId: 'p4' });
    expect(changedTokenFields({ clean: 'a', points: 3 }, { clean: 'a', points: 8 })).toEqual({
      points: 8,
    });
    expect(changedTokenFields({ clean: 'a', points: 3 }, { clean: 'a' })).toEqual({}); // gỡ token KHÔNG xoá ô đã điền
  });
});

describe('gợi ý và tô sáng', () => {
  it('gõ !ca gợi ý High nhờ bí danh "cao", chèn tên đầy đủ, hint hiện bí danh', () => {
    const s = suggestFor('!', 'ca', ctx);
    expect(s[0]).toMatchObject({ id: 'p4', insert: '!High' });
    expect(s[0]!.hint).toContain('cao');
  });
  it('token không khớp (không ở cuối) có đoạn kind "unknown"', () => {
    const seg = tokenSegments('Việc !xyz tiếp', ctx);
    expect(seg.some((s) => s.kind === 'unknown' && s.text === '!xyz')).toBe(true);
  });
});

describe('shouldAcceptSuggestionOnKey', () => {
  const k = (key: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean }> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    ...o,
  });
  it('Enter/Tab chọn gợi ý khi popup mở', () => {
    expect(shouldAcceptSuggestionOnKey(k('Enter'), true)).toBe('accept');
    expect(shouldAcceptSuggestionOnKey(k('Tab'), true)).toBe('accept');
  });
  it('⌘/Ctrl+Enter luôn nhường cho form tạo việc', () => {
    expect(shouldAcceptSuggestionOnKey(k('Enter', { metaKey: true }), true)).toBe('pass');
    expect(shouldAcceptSuggestionOnKey(k('Enter', { ctrlKey: true }), true)).toBe('pass');
  });
  it('popup đóng hoặc phím khác => không đụng', () => {
    expect(shouldAcceptSuggestionOnKey(k('Enter'), false)).toBe('none');
    expect(shouldAcceptSuggestionOnKey(k('a'), true)).toBe('none');
  });
});

describe('token nhiều từ đang gõ dở không bị báo sai', () => {
  it.each([
    'Việc !trung ',
    'Việc !rất ',
    'Việc !rat ',
    'Việc !khẩn ',
    'Việc !trung bi',
    'Việc !rất th',
  ])('%j => không báo', (t) => expect(unmatchedTokens(t, ctx)).toEqual([]));
  it('người/sprint nhiều từ gõ dở', () => {
    expect(unmatchedTokens('Việc @Bình (B', ctx)).toEqual([]);
    expect(unmatchedTokens('Việc @Bình ', ctx)).toEqual([]);
    expect(unmatchedTokens('Việc #Sprint 3 ', ctx)).toEqual([]);
  });
  it('tô sáng cũng không đánh dấu unknown khi đang gõ dở', () => {
    expect(
      tokenSegments('Việc !trung ', ctx, { skipTail: false }).some((s) => s.kind === 'unknown'),
    ).toBe(false);
  });
  it('vẫn báo khi sai thật: có chữ khác theo sau, hoặc không phải tiền tố nhiều từ', () => {
    expect(unmatchedTokens('Việc !trung xyz', ctx).map((t) => t.text)).toEqual(['!trung']);
    expect(unmatchedTokens('Việc !ca ', ctx).map((t) => t.text)).toEqual(['!ca']);
    expect(unmatchedTokens('Việc !trungbinhx ', ctx)).toHaveLength(1);
  });
});

describe('unmatchedHint', () => {
  it('liệt kê gợi ý của mọi loại token không khớp, mỗi loại một lần', () => {
    const u = unmatchedTokens('Việc !xyz ~abc !qq ^zzz', ctx);
    const h = unmatchedHint(u);
    expect(h).toContain('mức ưu tiên');
    expect(h).toContain('~5');
    expect(h).toContain('mai');
    expect(h.match(/mức ưu tiên/g)).toHaveLength(1);
  });
});

describe('parseDue: ngày không có năm', () => {
  const now = new Date(2026, 9, 16, 9, 0); // 16/10/2026
  it('ngày còn lại trong năm → năm nay', () => {
    expect(parseDue('15/12', now)).toBe('2026-12-15T17:00');
    expect(parseDue('16/10', now)).toBe('2026-10-16T17:00'); // hôm nay không phải "đã qua"
  });
  it('đã qua trong năm nay → hiểu là năm sau', () => {
    expect(parseDue('15/8', now)).toBe('2027-08-15T17:00');
    expect(parseDue('15/10', now)).toBe('2027-10-15T17:00');
  });
  it('có năm → giữ nguyên kể cả quá khứ (chỉ cảnh báo mềm ở form)', () => {
    expect(parseDue('15/8/2026', now)).toBe('2026-08-15T17:00');
    expect(parseDue('15/8/25', now)).toBe('2025-08-15T17:00');
  });
  it('ngày không có thật → không hiểu', () => {
    expect(parseDue('31/2', now)).toBeUndefined();
  });
});

describe('#<số> là tham chiếu, không phải sprint (WC-I2)', () => {
  const sp: TokenCtx = {
    ...ctx,
    sprints: [
      { id: 's1', name: 'Sprint 1', state: 'ACTIVE' },
      { id: 's12', name: 'Sprint 12', state: 'FUTURE' },
      { id: 's120', name: 'Sprint 120', state: 'FUTURE' },
    ],
  };
  it('#12 và #1 giữ nguyên trong tiêu đề, không gán sprint', () => {
    expect(parseTitleTokens('Fix lỗi #12', sp)).toMatchObject({ clean: 'Fix lỗi #12' });
    expect(parseTitleTokens('Fix lỗi #12', sp).sprintId).toBeUndefined();
    const r = parseTitleTokens('Họp #1 với khách', sp);
    expect(r.clean).toBe('Họp #1 với khách');
    expect(r.sprintId).toBeUndefined();
  });
  it('#sprint12 khớp đúng Sprint 12 (không bị Sprint 120 chen)', () => {
    expect(parseTitleTokens('A #sprint12', sp)).toMatchObject({ sprintId: 's12', clean: 'A' });
    expect(parseTitleTokens('A #Sprint-120', sp).sprintId).toBe('s120');
  });
  it('#S12 và #sprint1 mơ hồ/không đủ chặt → không khớp sai', () => {
    expect(parseTitleTokens('A #S12', sp).sprintId).toBeUndefined();
    expect(parseTitleTokens('A #S12', sp).clean).toBe('A #S12');
    // "sprint1" là tiền tố của sprint1, sprint12, sprint120 nhưng bằng đúng "Sprint 1" → khớp đúng.
    expect(parseTitleTokens('A #sprint1', sp).sprintId).toBe('s1');
  });
  it('tiền tố duy nhất ≥ 3 ký tự có chữ cái khớp; mơ hồ thì không', () => {
    const one: TokenCtx = {
      ...ctx,
      sprints: [{ id: 'a', name: 'Alpha release', state: 'FUTURE' }],
    };
    expect(parseTitleTokens('A #alp', one).sprintId).toBe('a');
    expect(parseTitleTokens('A #al', one).sprintId).toBeUndefined();
    const amb: TokenCtx = {
      ...ctx,
      sprints: [
        { id: 'a', name: 'Alpha', state: 'FUTURE' },
        { id: 'b', name: 'Alpine', state: 'FUTURE' },
      ],
    };
    expect(parseTitleTokens('A #alp', amb).sprintId).toBeUndefined();
  });
  it('#12 không bị báo là token không nhận ra', () => {
    expect(unmatchedTokens('Fix #12 và #1 fix', sp)).toEqual([]);
  });
  it('~2.5 và ~2,5 parse trọn, không để ".5" rác', () => {
    expect(parseTitleTokens('Giá ~2.5 tỷ', sp)).toMatchObject({ points: 2.5, clean: 'Giá tỷ' });
    expect(parseTitleTokens('Giá ~2,5 tỷ', sp)).toMatchObject({ points: 2.5, clean: 'Giá tỷ' });
    expect(parseTitleTokens('Việc ~5', sp)).toMatchObject({ points: 5, clean: 'Việc' });
  });
});

describe('ô đổi tay thắng token khi Tạo (WC-I1)', () => {
  const cur = { priorityId: 'p2', assigneeId: 'u2', sprintId: '', points: '', due: '' };
  const none = new Set<never>();
  it('token đã đồng bộ + ô đổi tay → giữ giá trị ô', () => {
    const tk = parseTitleTokens('Sửa !cao @Đức ', ctx);
    // đã đồng bộ (synced = tk), người dùng sau đó đổi ưu tiên về Low tay → ô thắng
    expect(resolveCreateValues(cur, tk, tk, new Set(['priorityId']))).toEqual(cur);
    // kể cả khi không đánh dấu tay: token không đổi so với lần đồng bộ nên cũng không ghi đè
    expect(resolveCreateValues(cur, tk, tk, none)).toEqual(cur);
  });
  it('token đuôi chưa đồng bộ → áp cho ô chưa đổi tay; ô đã đổi tay thì giữ', () => {
    const tk = parseTitleTokens('Sửa !cao', ctx);
    const synced = parseTitleTokens('Sửa', ctx);
    expect(resolveCreateValues(cur, synced, tk, none).priorityId).toBe('p4');
    expect(resolveCreateValues(cur, synced, tk, new Set(['priorityId'])).priorityId).toBe('p2');
  });
  it('điểm và hạn từ token chưa đồng bộ vào ô trống', () => {
    const tk = parseTitleTokens('A ~3', ctx);
    expect(resolveCreateValues(cur, { clean: '' }, tk, none).points).toBe('3');
  });
});
