import { describe, expect, it } from 'vitest';
import {
  changedTokenFields,
  parseTitleTokens,
  stripPartialTail,
  suggestFor,
  tokenSegments,
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
