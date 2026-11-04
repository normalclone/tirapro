import { describe, expect, it } from 'vitest';
import {
  BULK_MAX_ITEMS,
  expandKeys,
  isSelfName,
  parseBulkAddMember,
  parseBulkAssign,
  parseBulkCommand,
  parseBulkRemoveMember,
  parseFilter,
} from './bulkParse';

const P = 'KYHOP-SUB-';
const range = (a: number, b: number, prefix = P) =>
  Array.from({ length: b - a + 1 }, (_, i) => `${prefix}${a + i}`);

describe('expandKeys — danh sách và dải', () => {
  it('số trần dùng tiền tố của mã đứng trước: "KYHOP-SUB-11, 12, 15"', () => {
    expect(expandKeys('KYHOP-SUB-11, 12, 15').keys).toEqual([`${P}11`, `${P}12`, `${P}15`]);
  });
  it('dải bằng "..", "-", "–", "đến": cả hai đầu đều gồm', () => {
    for (const s of [
      'KYHOP-SUB-11..15',
      'KYHOP-SUB-11-15',
      'KYHOP-SUB-11–15',
      'KYHOP-SUB-11 đến 15',
      'KYHOP-SUB-11 toi 15',
    ])
      expect(expandKeys(s).keys, s).toEqual(range(11, 15));
  });
  it('dải đứng sau số trần: "KYHOP-SUB-3, 11-13" → 3, 11, 12, 13', () => {
    expect(expandKeys('KYHOP-SUB-3, 11-13').keys).toEqual([`${P}3`, ...range(11, 13)]);
  });
  it('không phân biệt hoa thường, chuẩn hoá thành chữ HOA', () => {
    expect(expandKeys('kyhop-sub-1, 2').keys).toEqual([`${P}1`, `${P}2`]);
  });
  it('mã đầy đủ mới đổi tiền tố: "DEMO-TASK-1, 2, ALPHA-BUG-9, 10"', () => {
    expect(expandKeys('DEMO-TASK-1, 2, ALPHA-BUG-9, 10').keys).toEqual([
      'DEMO-TASK-1',
      'DEMO-TASK-2',
      'ALPHA-BUG-9',
      'ALPHA-BUG-10',
    ]);
  });
  it('mã Jira gốc KEY-N và khoá có gạch dưới', () => {
    expect(expandKeys('JRA-5..7').keys).toEqual(['JRA-5', 'JRA-6', 'JRA-7']);
    expect(expandKeys('MY_APP-12, 13').keys).toEqual(['MY_APP-12', 'MY_APP-13']);
  });
  it('trùng mã chỉ giữ lần đầu, giữ thứ tự xuất hiện', () => {
    expect(expandKeys('KYHOP-SUB-5, 3, 5, 1..4').keys).toEqual([
      `${P}5`,
      `${P}3`,
      `${P}1`,
      `${P}2`,
      `${P}4`,
    ]);
  });
  it('số trần đứng TRƯỚC mọi mã → báo lỗi, không đoán tiền tố', () => {
    const r = expandKeys('12, KYHOP-SUB-13');
    expect(r.keys).toEqual([`${P}13`]);
    expect(r.problems.join(' ')).toMatch(/Số 12 đứng trước mọi mã/);
  });
  it('dải ngược 20..11 → lỗi, không tạo mã nào', () => {
    const r = expandKeys('KYHOP-SUB-20..11');
    expect(r.keys).toEqual([]);
    expect(r.problems.join(' ')).toMatch(/ngược/);
  });
  it('dải quá lớn → lỗi (không bung hàng nghìn mã)', () => {
    const r = expandKeys('KYHOP-SUB-1..5000');
    expect(r.keys).toEqual([]);
    expect(r.problems.join(' ')).toMatch(new RegExp(`tối đa ${BULK_MAX_ITEMS}`));
  });
  it('nhiều dải cộng lại vượt trần → cắt về trần + báo', () => {
    const r = expandKeys('KYHOP-SUB-1..150, 300..450');
    expect(r.keys).toHaveLength(BULK_MAX_ITEMS);
    expect(r.problems.join(' ')).toMatch(/Quá 200 việc/);
  });
  it('dải một phần tử 5..5 → một mã', () => {
    expect(expandKeys('KYHOP-SUB-5..5').keys).toEqual([`${P}5`]);
  });
  it('lastPrefix cho phép nối tiếp sang đoạn sau (kiểu theo cặp)', () => {
    const a = expandKeys('KYHOP-SUB-11');
    expect(expandKeys('12', a.lastPrefix).keys).toEqual([`${P}12`]);
  });
});

describe('parseBulkAssign — giao hàng loạt', () => {
  it('danh sách mã → một người', () => {
    expect(parseBulkAssign('giao KYHOP-SUB-11, 12, 15 cho Thuỷ')).toEqual({
      kind: 'bulk-assign',
      selector: { kind: 'keys', keys: [`${P}11`, `${P}12`, `${P}15`] },
      people: ['Thuỷ'],
      pairs: null,
      problems: [],
    });
  });
  it('dải mã, nhiều người nhận ("," và "và")', () => {
    const a = parseBulkAssign('giao KYHOP-SUB-11..20 cho Linh, Hà');
    expect(a?.selector).toEqual({ kind: 'keys', keys: range(11, 20) });
    expect(a?.people).toEqual(['Linh', 'Hà']); // "Hà" KHÔNG bị nuốt như từ đệm
    expect(parseBulkAssign('giao KYHOP-SUB-1, 2 cho An và Bình')?.people).toEqual(['An', 'Bình']);
  });
  it('động từ khác (gán, phân công, assign) và lời lịch sự / đuôi "nhé"', () => {
    for (const s of [
      'gán KYHOP-SUB-1 cho An',
      'phân công KYHOP-SUB-1 cho An',
      'assign KYHOP-SUB-1 cho An',
      'hãy giúp mình giao KYHOP-SUB-1 cho An nhé',
      'Giao KYHOP-SUB-1 cho An giúp mình',
    ])
      expect(parseBulkAssign(s)?.people, s).toEqual(['An']);
  });
  it('"cho tôi/mình" = chính người gõ', () => {
    const a = parseBulkAssign('giao KYHOP-SUB-11 cho tôi')!;
    expect(a.people).toEqual(['tôi']);
    expect(isSelfName(a.people[0]!)).toBe(true);
    expect(isSelfName('Mình')).toBe(true);
    expect(isSelfName('Minh')).toBe(false); // tên người "Minh" không phải "mình"
  });
  it('việc con của một việc', () => {
    expect(parseBulkAssign('giao việc con của KYHOP-TASK-12 cho An')?.selector).toEqual({
      kind: 'children',
      parentKey: 'KYHOP-TASK-12',
    });
    expect(parseBulkAssign('giao các việc con của kyhop-task-12 cho An')?.selector).toEqual({
      kind: 'children',
      parentKey: 'KYHOP-TASK-12',
    });
  });
  it('bộ lọc nhẹ: tiền tố [Test], chưa giao, dự án', () => {
    expect(parseBulkAssign('giao các việc [Test] chưa giao của KYHOP cho Linh')).toMatchObject({
      selector: {
        kind: 'filter',
        filter: { titlePrefix: '[Test]', unassigned: true, project: 'KYHOP' },
      },
      people: ['Linh'],
    });
  });
  it('theo cặp: "giao A cho X, B cho Y"', () => {
    const a = parseBulkAssign('giao KYHOP-SUB-11 cho Thuỷ, KYHOP-SUB-12 cho Linh')!;
    expect(a.selector).toBeNull();
    expect(a.pairs).toEqual([
      { key: `${P}11`, person: 'Thuỷ' },
      { key: `${P}12`, person: 'Linh' },
    ]);
  });
  it('theo cặp có dải và số trần dùng tiền tố đoạn trước', () => {
    const a = parseBulkAssign('giao KYHOP-SUB-11..13 cho An, 20 cho Bình')!;
    expect(a.pairs).toEqual([
      { key: `${P}11`, person: 'An' },
      { key: `${P}12`, person: 'An' },
      { key: `${P}13`, person: 'An' },
      { key: `${P}20`, person: 'Bình' },
    ]);
  });
  it('một vế "cho" nhưng nhiều người KHÔNG bị hiểu là theo cặp', () => {
    expect(parseBulkAssign('giao KYHOP-SUB-11, 12 cho Thuỷ, Linh')).toMatchObject({
      pairs: null,
      people: ['Thuỷ', 'Linh'],
      selector: { kind: 'keys' },
    });
  });
  it('lỗi cú pháp đi theo kết quả, không làm hỏng phần còn lại', () => {
    expect(parseBulkAssign('giao KYHOP-SUB-20..11 cho An')).toMatchObject({
      selector: null,
      people: ['An'],
      problems: [expect.stringMatching(/ngược/)],
    });
    expect(parseBulkAssign('giao 12 cho An')).toMatchObject({
      selector: null,
      problems: [expect.stringMatching(/chưa hiểu/)],
    });
  });
  it('không phải lệnh giao: thiếu "cho", thiếu việc, thiếu người, câu khác', () => {
    expect(parseBulkAssign('giao cho tôi')).toBeNull();
    expect(parseBulkAssign('giao KYHOP-SUB-11')).toBeNull();
    expect(parseBulkAssign('giao KYHOP-SUB-11 cho')).toBeNull();
    expect(parseBulkAssign('việc giao cho tôi')).toBeNull();
    expect(parseBulkAssign('tạo việc Giao hàng cho khách')).toBeNull();
  });
  it('"cho" nằm trong ngoặc vuông của tiền tố không làm vỡ câu', () => {
    const a = parseBulkAssign('giao các việc [Cho phép] chưa giao của KYHOP cho Linh');
    expect(a?.selector).toMatchObject({ filter: { titlePrefix: '[Cho phép]' } });
    expect(a?.people).toEqual(['Linh']);
  });
});

describe('parseFilter', () => {
  it('loại việc: bug / sub-task / task / story', () => {
    expect(parseFilter('các bug chưa giao của KYHOP')).toEqual({
      kind: 'filter',
      filter: { type: 'bug', unassigned: true, project: 'KYHOP' },
    });
    expect(parseFilter('các sub-task [Test] của KYHOP')).toMatchObject({
      filter: { type: 'sub-task', titlePrefix: '[Test]' },
    });
    expect(parseFilter('các task của KYHOP')).toMatchObject({ filter: { type: 'task' } });
    expect(parseFilter('các story của KYHOP')).toMatchObject({ filter: { type: 'story' } });
  });
  it('Epic theo mã', () => {
    expect(parseFilter('các việc thuộc epic KYHOP-EPIC-3 chưa giao')).toMatchObject({
      filter: { epicKey: 'KYHOP-EPIC-3', unassigned: true },
    });
  });
  it('dự án phải VIẾT HOA (mã) — "của tôi" / chữ thường không bị hiểu là dự án', () => {
    expect(parseFilter('các việc chưa giao của tôi')).toMatchObject({
      filter: { unassigned: true },
    });
    expect(
      (parseFilter('các việc chưa giao của tôi') as { filter: { project?: string } }).filter
        .project,
    ).toBeUndefined();
    expect(parseFilter('các việc chưa giao trong dự án KYHOP')).toMatchObject({
      filter: { project: 'KYHOP' },
    });
  });
  it('không nhận ra gì → null', () => {
    expect(parseFilter('mấy cái việc linh tinh')).toBeNull();
  });
});

describe('parseBulkAddMember — thêm thành viên', () => {
  it('nhiều người vào nhiều dự án với vai trò', () => {
    expect(parseBulkAddMember('thêm Linh, Thuỷ vào KYHOP, LLTT với vai trò Tester')).toEqual({
      kind: 'bulk-add-member',
      people: ['Linh', 'Thuỷ'],
      teams: [],
      targets: { refs: ['KYHOP', 'LLTT'], group: null },
      role: 'Tester',
      problems: [],
    });
  });
  it('"Nhóm QA" ở vế người = team của tổ chức', () => {
    expect(parseBulkAddMember('thêm Nhóm QA vào GSDA vai trò Tester')).toMatchObject({
      people: [],
      teams: ['QA'],
      targets: { refs: ['GSDA'], group: null },
      role: 'Tester',
    });
    expect(parseBulkAddMember('thêm nhóm QA và Hương vào GSDA')).toMatchObject({
      people: ['Hương'],
      teams: ['QA'],
    });
  });
  it('"nhóm X của tôi" ở vế dự án = nhóm dự án cá nhân', () => {
    expect(parseBulkAddMember('thêm Hương vào mọi dự án nhóm Thanh Hóa của tôi')).toMatchObject({
      people: ['Hương'],
      teams: [],
      targets: { refs: [], group: 'Thanh Hóa' },
      role: null,
    });
    expect(
      parseBulkAddMember('thêm Hương vào nhóm Thanh Hóa của mình vai trò Developer'),
    ).toMatchObject({
      targets: { refs: [], group: 'Thanh Hóa' },
      role: 'Developer',
    });
  });
  it('trộn dự án nêu tên và nhóm; chữ "dự án" đứng đầu được bỏ; vai trò nhiều từ', () => {
    expect(
      parseBulkAddMember(
        'thêm An vào dự án KYHOP và nhóm Hà Nội của tôi với vai trò Project Admin',
      ),
    ).toMatchObject({
      targets: { refs: ['KYHOP'], group: 'Hà Nội' },
      role: 'Project Admin',
    });
  });
  it('động từ khác (add, đưa), lịch sự, đuôi "nhé"', () => {
    expect(parseBulkAddMember('add Linh vào KYHOP')?.people).toEqual(['Linh']);
    expect(parseBulkAddMember('đưa Linh vào KYHOP nhé')?.targets.refs).toEqual(['KYHOP']);
    expect(parseBulkAddMember('giúp mình thêm Linh vào KYHOP')?.people).toEqual(['Linh']);
  });
  it('hai nhóm dự án trong một lệnh → báo lỗi (chỉ một nhóm mỗi lệnh)', () => {
    const r = parseBulkAddMember('thêm An vào nhóm A của tôi và nhóm B của tôi')!;
    expect(r.problems).toEqual(['Mỗi lệnh chỉ dùng được MỘT nhóm dự án.']);
  });
  it('không phải lệnh: thiếu "vào", thiếu người, thiếu dự án', () => {
    expect(parseBulkAddMember('thêm Linh')).toBeNull();
    expect(parseBulkAddMember('thêm vào KYHOP')).toBeNull();
    expect(parseBulkAddMember('thêm Linh vào')).toBeNull();
  });
});

describe('parseBulkRemoveMember — gỡ thành viên', () => {
  it('gỡ một người khỏi nhiều dự án', () => {
    expect(parseBulkRemoveMember('gỡ Linh khỏi KYHOP, LLTT')).toEqual({
      kind: 'bulk-remove-member',
      people: ['Linh'],
      targets: { refs: ['KYHOP', 'LLTT'], group: null },
      problems: [],
    });
  });
  it('xoá / bỏ / loại / "ra khỏi", nhiều người, "dự án", nhóm cá nhân', () => {
    expect(parseBulkRemoveMember('xoá Linh và Thuỷ khỏi dự án KYHOP nhé')).toMatchObject({
      people: ['Linh', 'Thuỷ'],
      targets: { refs: ['KYHOP'] },
    });
    expect(parseBulkRemoveMember('loại Linh ra khỏi KYHOP')?.people).toEqual(['Linh']);
    expect(parseBulkRemoveMember('bỏ An khỏi mọi dự án nhóm Hà Nội của tôi')).toMatchObject({
      people: ['An'],
      targets: { refs: [], group: 'Hà Nội' },
    });
  });
  it('không phải lệnh: thiếu "khỏi", thiếu dự án ("xoá task X" là việc khác)', () => {
    expect(parseBulkRemoveMember('xoá task KYHOP-TASK-1')).toBeNull();
    expect(parseBulkRemoveMember('gỡ Linh')).toBeNull();
    expect(parseBulkRemoveMember('gỡ Linh khỏi')).toBeNull();
  });
});

describe('parseBulkCommand', () => {
  it('chọn đúng lệnh; câu thường → null', () => {
    expect(parseBulkCommand('giao KYHOP-SUB-1 cho An')?.kind).toBe('bulk-assign');
    expect(parseBulkCommand('thêm An vào KYHOP')?.kind).toBe('bulk-add-member');
    expect(parseBulkCommand('gỡ An khỏi KYHOP')?.kind).toBe('bulk-remove-member');
    expect(parseBulkCommand('việc của tôi')).toBeNull();
    expect(parseBulkCommand('')).toBeNull();
  });
});

describe('mã Epic là phạm vi lọc, không phải việc cần giao', () => {
  it('"các việc thuộc epic KEY chưa giao" → filter epicKey, không phải danh sách mã', () => {
    const i = parseBulkAssign('giao các việc thuộc epic DEMO-EPIC-1 chưa giao cho Linh')!;
    expect(i.selector).toEqual({
      kind: 'filter',
      filter: { epicKey: 'DEMO-EPIC-1', unassigned: true },
    });
  });
  it('"giao DEMO-EPIC-1 cho Linh" (không chữ epic) vẫn là một mã việc', () => {
    expect(parseBulkAssign('giao DEMO-EPIC-1 cho Linh')!.selector).toEqual({
      kind: 'keys',
      keys: ['DEMO-EPIC-1'],
    });
  });
});
