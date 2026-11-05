import { describe, expect, it } from 'vitest';
import { parseJql } from '@tirapro/shared';
import {
  filterToJql,
  prefixKeyword,
  resolveGroup,
  resolveMany,
  resolvePerson,
  resolveProject,
  resolveRole,
  resolveTeam,
  titlePrefixMatches,
} from './bulkResolve';
import { GROUPS, PEOPLE, ROLES, TEAMS } from './fixtures';

const okId = (r: ReturnType<typeof resolvePerson>) => (r.status === 'ok' ? r.value.id : r.status);

describe('resolvePerson — không dấu, không phân biệt hoa thường', () => {
  it('tên đầy đủ / tên riêng / bỏ dấu / chữ thường', () => {
    expect(okId(resolvePerson('An Nguyễn', PEOPLE))).toBe('u-an');
    expect(okId(resolvePerson('an nguyen', PEOPLE))).toBe('u-an');
    expect(okId(resolvePerson('Bình', PEOPLE))).toBe('u-binh');
    expect(okId(resolvePerson('binh', PEOPLE))).toBe('u-binh');
    expect(okId(resolvePerson('HƯƠNG', PEOPLE))).toBe('u-huong');
  });
  it('khớp theo email (cả hoa thường) và chỉ khi gõ có "@"', () => {
    expect(okId(resolvePerson('THUY.LE@x.vn', PEOPLE))).toBe('u-thuy2');
    expect(okId(resolvePerson('linh@x.vn', PEOPLE))).toBe('u-linh');
    expect(resolvePerson('nobody@x.vn', PEOPLE).status).toBe('none');
  });
  it('hai người cùng tên riêng → MƠ HỒ, kèm danh sách để chọn (Thuỷ / Thủy cùng chữ khi bỏ dấu)', () => {
    const r = resolvePerson('Thuỷ', PEOPLE);
    expect(r.status).toBe('ambiguous');
    expect(r.status === 'ambiguous' && r.options.map((o) => o.id).sort()).toEqual([
      'u-thuy1',
      'u-thuy2',
    ]);
    expect(resolvePerson('thuy', PEOPLE).status).toBe('ambiguous');
  });
  it('thêm họ/email thu hẹp thành một người', () => {
    expect(okId(resolvePerson('Nguyễn Thị Thuỷ', PEOPLE))).toBe('u-thuy1');
    expect(okId(resolvePerson('Lê Thủy', PEOPLE))).toBe('u-thuy2');
    expect(okId(resolvePerson('Lê Thuỷ', PEOPLE))).toBe('u-thuy2');
  });
  it('"An" không nhầm với "Anh"/"Ân" — khớp TỪ NGUYÊN trước, tiền tố sau', () => {
    const list = [
      { id: 'a', displayName: 'An Lê' },
      { id: 'b', displayName: 'Hoàng Anh' },
    ];
    expect(okId(resolvePerson('An', list))).toBe('a');
    expect(okId(resolvePerson('Anh', list))).toBe('b');
  });
  it('tiền tố chỉ dùng khi không có khớp nguyên từ ("Hươ" → Hương); nhiều ứng viên vẫn mơ hồ', () => {
    expect(okId(resolvePerson('Hươ', PEOPLE))).toBe('u-huong');
    expect(resolvePerson('Thu', PEOPLE).status).toBe('ambiguous');
  });
  it('M2: tiền tố ngắn (< 3 ký tự) không bao giờ khớp: "Hà", "H", "Ng" không rơi vào "Phạm Hải"', () => {
    const list = [{ id: 'hai', displayName: 'Phạm Hải' }];
    for (const q of ['Hà', 'Ha', 'H', 'Ng', 'Th'])
      expect(resolvePerson(q, list).status).toBe('none');
    expect(okId(resolvePerson('Hải', list))).toBe('hai');
  });
  it('M2: khớp một phần tên / tiền tố → ok nhưng đánh dấu approx; khớp tên đầy đủ hoặc tên gọi thì không', () => {
    const list = [
      { id: 'van', displayName: 'Nguyễn Văn An' },
      { id: 'tran', displayName: 'Trần Quốc Hương' },
    ];
    const middle = resolvePerson('Văn', list);
    expect(middle).toMatchObject({ status: 'ok', approx: true, value: { id: 'van' } });
    expect(resolvePerson('Nguyễn', list)).toMatchObject({ status: 'ok', approx: true });
    expect(resolvePerson('Hươ', list)).toMatchObject({
      status: 'ok',
      approx: true,
      value: { id: 'tran' },
    });
    // tiền tố chỉ ở từ giữa/họ của tên ≥ 3 từ: không khớp
    expect(resolvePerson('Quố', list).status).toBe('none');
    // tên gọi (từ cuối) và tên đầy đủ: chắc chắn
    expect(resolvePerson('An', list)).not.toHaveProperty('approx');
    expect(resolvePerson('Hương', list)).not.toHaveProperty('approx');
    expect(resolvePerson('nguyen van an', list)).not.toHaveProperty('approx');
    expect(resolvePerson('x', list).status).toBe('none');
  });
  it('M2: tên 2 từ — từ nào cũng là lõi (không biết thứ tự họ/tên)', () => {
    const list = [{ id: 'h', displayName: 'Hương Đỗ' }];
    expect(resolvePerson('Hương', list)).toMatchObject({ status: 'ok' });
    expect(resolvePerson('Hương', list)).not.toHaveProperty('approx');
  });
  it('M2: dự án / nhóm / vai trò chỉ chắc khi khớp NGUYÊN tên hoặc mã; khớp một phần là approx', () => {
    const groups = [{ id: 'g', name: 'QA Hà Nội', projects: [] }];
    expect(resolveGroup('QA', groups)).toMatchObject({ status: 'ok', approx: true });
    expect(resolveGroup('qa ha noi', groups)).not.toHaveProperty('approx');
    const projects = [{ id: 'p', key: 'LLTT', name: 'Lý luận chính trị' }];
    expect(resolveProject('LLT', projects)).toMatchObject({ status: 'ok', approx: true });
    expect(resolveProject('lltt', projects)).not.toHaveProperty('approx');
    expect(resolveProject('LL', projects).status).toBe('none');
  });
  it('M2: người gõ CÓ dấu và đúng một ứng viên khớp đúng dấu → chọn, không bắt chọn ("Hà" khi có cả Hà và Hạ)', () => {
    const list = [
      { id: 'ha', displayName: 'Lê Hà' },
      { id: 'ha2', displayName: 'Vũ Hạ' },
    ];
    expect(okId(resolvePerson('Hà', list))).toBe('ha');
    expect(okId(resolvePerson('Hạ', list))).toBe('ha2');
    // không dấu thì vẫn mơ hồ
    expect(resolvePerson('Ha', list).status).toBe('ambiguous');
  });
  it('M2: hai lối đặt dấu của cùng một chữ (Thuỷ / Thủy) vẫn là mơ hồ, không bị "ưu tiên đúng dấu"', () => {
    const list = [
      { id: 'a', displayName: 'Nguyễn Thị Thuỷ' },
      { id: 'b', displayName: 'Lê Thủy' },
    ];
    expect(resolvePerson('Thuỷ', list).status).toBe('ambiguous');
    expect(resolvePerson('Thủy', list).status).toBe('ambiguous');
  });
  it('khớp nguyên tên đầy đủ thắng khớp từng phần', () => {
    const list = [
      { id: 'a', displayName: 'Linh' },
      { id: 'b', displayName: 'Linh Đan' },
    ];
    expect(okId(resolvePerson('Linh', list))).toBe('a');
  });
  it('hai người trùng HẼT tên → mơ hồ (không tự chọn)', () => {
    const list = [
      { id: 'a', displayName: 'Lan Phạm', email: 'a@x' },
      { id: 'b', displayName: 'Lan Phạm', email: 'b@x' },
    ];
    expect(resolvePerson('Lan Phạm', list).status).toBe('ambiguous');
    expect(okId(resolvePerson('b@x', list))).toBe('b');
  });
  it('không thấy / chuỗi rỗng → none', () => {
    expect(resolvePerson('Zzz', PEOPLE).status).toBe('none');
    expect(resolvePerson('   ', PEOPLE).status).toBe('none');
    expect(resolvePerson('x', []).status).toBe('none');
  });
});

describe('resolveProject', () => {
  const projects = [
    { id: 'p1', key: 'KYHOP', name: 'Kỳ họp' },
    { id: 'p2', key: 'LLTT', name: 'Lý lịch tư pháp' },
    { id: 'p3', key: 'KYHOP2', name: 'Kỳ họp mở rộng' },
  ];
  it('theo mã (không phân biệt hoa thường) hoặc tên không dấu', () => {
    expect(resolveProject('kyhop', projects)).toMatchObject({ status: 'ok', value: { id: 'p1' } });
    expect(resolveProject('Ky hop', projects)).toMatchObject({ status: 'ok', value: { id: 'p1' } });
    expect(resolveProject('lý lịch tư pháp', projects)).toMatchObject({
      status: 'ok',
      value: { id: 'p2' },
    });
  });
  it('mã khớp nguyên thắng mã chỉ có chung tiền tố (KYHOP vs KYHOP2)', () => {
    expect(resolveProject('KYHOP', projects)).toMatchObject({ status: 'ok', value: { id: 'p1' } });
    expect(resolveProject('KYHOP2', projects)).toMatchObject({ status: 'ok', value: { id: 'p3' } });
  });
  it('tên chung nhiều dự án → mơ hồ; không thấy → none', () => {
    expect(resolveProject('họp', projects).status).toBe('ambiguous');
    expect(resolveProject('ABC', projects).status).toBe('none');
  });
});

describe('resolveTeam / resolveGroup / resolveRole', () => {
  it('team theo tên không dấu', () => {
    expect(resolveTeam('qa', TEAMS)).toMatchObject({ status: 'ok', value: { id: 't-qa' } });
    expect(resolveTeam('Dev', TEAMS).status).toBe('none');
  });
  it('nhóm dự án cá nhân theo tên không dấu ("Thanh Hoa" → "Thanh Hóa")', () => {
    expect(resolveGroup('thanh hoa', GROUPS)).toMatchObject({
      status: 'ok',
      value: { id: 'g-th' },
    });
    expect(resolveGroup('Hà Nội', GROUPS).status).toBe('none');
  });
  it('vai trò: "tester" / "project admin" / một phần tên', () => {
    expect(resolveRole('tester', ROLES)).toMatchObject({ status: 'ok', value: { id: 'r-tester' } });
    expect(resolveRole('Project Admin', ROLES)).toMatchObject({
      status: 'ok',
      value: { id: 'r-admin' },
    });
    expect(resolveRole('admin', ROLES)).toMatchObject({ status: 'ok', value: { id: 'r-admin' } });
    expect(resolveRole('khách', ROLES).status).toBe('none');
  });
});

describe('resolveMany', () => {
  it('cùng một người nêu hai lần (tên + email) chỉ giữ lần đầu; mơ hồ/không thấy vẫn giữ nguyên để báo', () => {
    const out = resolveMany(
      ['Linh', 'linh@x.vn', 'Thuỷ', 'Zzz'],
      (q) => resolvePerson(q, PEOPLE),
      (p) => p.id,
    );
    expect(out.map((r) => r.status)).toEqual(['ok', 'ambiguous', 'none']);
  });
});

describe('filterToJql / titlePrefixMatches', () => {
  it('dựng JQL và JQL luôn parse được (kể cả ký tự lạ trong từ khoá)', () => {
    const jql = filterToJql({
      projectKey: 'KYHOP',
      typeName: 'Sub-task',
      unassigned: true,
      titleContains: 'Test',
    });
    expect(jql).toBe(
      'project = "KYHOP" AND type = "Sub-task" AND assignee IS EMPTY AND summary ~ "Test" ORDER BY key ASC',
    );
    expect(() => parseJql(jql)).not.toThrow();
    const evil = filterToJql({ projectKey: 'K"; DROP', titleContains: 'a" OR 1=1 "' });
    expect(() => parseJql(evil)).not.toThrow();
    expect(evil).not.toMatch(/"[^"]*"[^"]*"[^"]*"[^"]*OR 1=1/); // dấu " đã bị bỏ khỏi giá trị
    expect(filterToJql({ projectKey: 'ABC' })).toBe('project = "ABC" ORDER BY key ASC');
  });
  it('JQL của bộ lọc không có tên trạng thái nào (tên do quy trình từng tổ chức)', () => {
    expect(
      filterToJql({ projectKey: 'A', typeName: 'Bug', unassigned: true, titleContains: 'x' }),
    ).not.toMatch(/\bstatus\b/i);
  });
  it('tiền tố tiêu đề: bỏ dấu, hoa thường, khoảng trắng đầu; chỉ khớp ở ĐẦU', () => {
    expect(titlePrefixMatches('[Test] Đăng nhập', '[test]')).toBe(true);
    expect(titlePrefixMatches('  [TEST]Đăng nhập', '[Test]')).toBe(true);
    expect(titlePrefixMatches('Sửa [Test] đăng nhập', '[Test]')).toBe(false);
    expect(titlePrefixMatches('[Kiểm thử] a', '[kiem thu]')).toBe(true);
    expect(prefixKeyword('[Test]')).toBe('Test');
  });
});
