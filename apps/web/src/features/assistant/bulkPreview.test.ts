import { describe, expect, it } from 'vitest';
import {
  SKIP,
  assignInputs,
  assignOutcome,
  computeAssign,
  computeMembers,
  initialAssignState,
  initialMemberState,
  memberInputs,
  membersOutcome,
  undoOutcome,
  type AssignCard,
  type AssignRowSrc,
  type CardPerson,
  type MemberCard,
  type PersonSlot,
} from './bulkPreview';

const person = (id: string, name = id, email: string | null = `${id}@x.vn`): CardPerson => ({
  id,
  name,
  email,
});
const LINH = person('u-linh', 'Phạm Linh');
const AN = person('u-an', 'An Nguyễn');
const THUY1 = person('u-t1', 'Nguyễn Thị Thuỷ', 'thuy.nguyen@x.vn');
const THUY2 = person('u-t2', 'Lê Thủy', 'thuy.le@x.vn');
const slot = (p: CardPerson, over: Partial<PersonSlot> = {}): PersonSlot => ({
  query: p.name,
  person: p,
  options: null,
  ...over,
});

const row = (n: number, over: Partial<AssignRowSrc> = {}): AssignRowSrc => ({
  issueId: `i${n}`,
  key: `DEMO-${n}`,
  summary: `Việc ${n}`,
  version: 1,
  projectId: 'p1',
  projectKey: 'DEMO',
  current: null,
  points: null,
  allowed: true,
  ...over,
});

function assignCard(over: Partial<AssignCard> = {}): AssignCard {
  return {
    kind: 'assign',
    rows: [row(1), row(2), row(3), row(4)],
    slots: [slot(LINH), slot(AN)],
    unmatched: [],
    modes: ['one', 'round-robin', 'points'],
    defaultMode: 'round-robin',
    loads: {},
    filterNotes: [],
    filterJql: null,
    truncated: false,
    missingKeys: [],
    notes: [],
    problems: [],
    ...over,
  };
}
const targets = (c: ReturnType<typeof computeAssign>) =>
  c.rows.map((r) => `${r.src.key}:${r.target?.id ?? '-'}:${r.status}`);

describe('computeAssign — cách chia', () => {
  it('"Tất cả cho một người": mọi việc cho người chọn (mặc định người đầu)', () => {
    const card = assignCard({ defaultMode: 'one' });
    const st = initialAssignState(card);
    expect(targets(computeAssign(card, st))).toEqual([
      'DEMO-1:u-linh:ok',
      'DEMO-2:u-linh:ok',
      'DEMO-3:u-linh:ok',
      'DEMO-4:u-linh:ok',
    ]);
    const an = computeAssign(card, { ...st, oneId: 'u-an' });
    expect(an.rows.every((r) => r.target?.id === 'u-an')).toBe(true);
  });

  it('"Chia đều lần lượt" theo thứ tự mã; bỏ một dòng thì dòng sau dồn lên (không lệch vòng)', () => {
    const card = assignCard();
    const st = initialAssignState(card);
    expect(targets(computeAssign(card, st))).toEqual([
      'DEMO-1:u-linh:ok',
      'DEMO-2:u-an:ok',
      'DEMO-3:u-linh:ok',
      'DEMO-4:u-an:ok',
    ]);
    const skipped = computeAssign(card, { ...st, overrides: { i1: SKIP } });
    expect(targets(skipped)).toEqual([
      'DEMO-1:-:skip',
      'DEMO-2:u-linh:ok',
      'DEMO-3:u-an:ok',
      'DEMO-4:u-linh:ok',
    ]);
  });

  it('"Chia đều theo điểm": cân tổng điểm, tính cả việc đang giữ; việc chưa ước lượng tính 1 điểm', () => {
    const card = assignCard({
      rows: [
        row(1, { points: 8 }),
        row(2, { points: 3 }),
        row(3, { points: 3 }),
        row(4, { points: 2 }),
      ],
      loads: { 'u-linh': 0, 'u-an': 10 }, // An đang giữ sẵn 10 điểm
    });
    const c = computeAssign(card, { ...initialAssignState(card), mode: 'points' });
    // Việc 8 điểm → Linh (nhẹ nhất); An còn nhẹ hơn Linh(8)? An=10 > Linh=8 nên 3 → Linh(11)? Kiểm bằng tổng cuối.
    const sum = (id: string) =>
      c.perPerson.find((p) => p.person.id === id)!.points + (card.loads[id] ?? 0);
    expect(Math.abs(sum('u-linh') - sum('u-an'))).toBeLessThanOrEqual(3);
    const unestimated = assignCard({ rows: [row(1), row(2)], slots: [slot(LINH), slot(AN)] });
    const u = computeAssign(unestimated, { ...initialAssignState(unestimated), mode: 'points' });
    expect(u.perPerson.map((p) => p.points)).toEqual([1, 1]);
  });

  it('"Theo cặp": mỗi việc đúng người đã nêu; tên mơ hồ chưa chọn thì dòng chưa có người', () => {
    const card = assignCard({
      rows: [row(1, { pairQuery: 'Linh' }), row(2, { pairQuery: 'Thuỷ' })],
      slots: [
        slot(LINH, { query: 'Linh' }),
        { query: 'Thuỷ', person: null, options: [THUY1, THUY2] },
      ],
      modes: ['pairs', 'one', 'round-robin', 'points'],
      defaultMode: 'pairs',
    });
    const st = initialAssignState(card);
    const before = computeAssign(card, st);
    expect(targets(before)).toEqual(['DEMO-1:u-linh:ok', 'DEMO-2:-:no-person']);
    expect(before.canConfirm).toBe(false);
    const after = computeAssign(card, { ...st, picks: { Thuỷ: 'u-t2' } });
    expect(targets(after)).toEqual(['DEMO-1:u-linh:ok', 'DEMO-2:u-t2:ok']);
    expect(after.canConfirm).toBe(true);
  });

  it('sửa tay từng dòng: đổi người / bỏ dòng thắng cách chia', () => {
    const card = assignCard();
    const c = computeAssign(card, {
      ...initialAssignState(card),
      overrides: { i1: 'u-an', i2: SKIP },
    });
    expect(targets(c).slice(0, 2)).toEqual(['DEMO-1:u-an:ok', 'DEMO-2:-:skip']);
  });
});

describe('computeAssign — xác nhận bị khoá khi nào (Review Focus 1, 2)', () => {
  it('tên mơ hồ chưa chọn → KHÔNG xác nhận được, nói rõ tên nào; chọn xong mới mở khoá', () => {
    const card = assignCard({
      slots: [{ query: 'Thuỷ', person: null, options: [THUY1, THUY2] }],
      defaultMode: 'one',
    });
    const st = initialAssignState(card);
    const c = computeAssign(card, st);
    expect(c.canConfirm).toBe(false);
    expect(c.unresolvedChoices).toEqual(['Thuỷ']);
    expect(c.blocking.join(' ')).toContain('“Thuỷ”');
    expect(assignInputs(c)).toEqual([]); // chưa có người nhận → không có dòng ok;
    const picked = computeAssign(card, { ...st, picks: { Thuỷ: 'u-t1' }, oneId: 'u-t1' });
    expect(picked.canConfirm).toBe(true);
  });

  it('tên không thấy / lỗi chặn của lệnh / không dòng nào để ghi / chưa có người → khoá', () => {
    expect(
      computeAssign(assignCard({ unmatched: ['Zzz'] }), initialAssignState(assignCard()))
        .canConfirm,
    ).toBe(false);
    const withProblem = assignCard({ problems: ['DEMO-1 được nêu cho hai người khác nhau'] });
    expect(computeAssign(withProblem, initialAssignState(withProblem)).canConfirm).toBe(false);
    const none = assignCard({ slots: [], unmatched: [] });
    expect(computeAssign(none, initialAssignState(none)).blocking).toContain('Chưa có người nhận.');
    const allSame = assignCard({
      rows: [row(1, { current: LINH })],
      slots: [slot(LINH)],
      defaultMode: 'one',
    });
    const c = computeAssign(allSame, initialAssignState(allSame));
    expect(c.canConfirm).toBe(false);
    expect(c.rows[0]!.status).toBe('same');
    const pairsWithout = assignCard();
    expect(
      computeAssign(pairsWithout, { ...initialAssignState(pairsWithout), mode: 'pairs' })
        .canConfirm,
    ).toBe(false);
  });

  it('dòng không đủ quyền KHÔNG BAO GIỜ nằm trong yêu cầu gửi; dòng đủ quyền vẫn gửi', () => {
    const card = assignCard({
      rows: [
        row(1),
        row(2, { allowed: false, projectKey: 'ZED', projectId: 'p2' }),
        row(3, { allowed: undefined }),
      ],
      defaultMode: 'one',
    });
    const c = computeAssign(card, initialAssignState(card));
    expect(c.rows[1]).toMatchObject({ status: 'no-perm' });
    expect(c.canConfirm).toBe(true);
    expect(assignInputs(c)).toEqual([
      { issueId: 'i1', version: 1, assigneeId: 'u-linh' },
      { issueId: 'i3', version: 1, assigneeId: 'u-linh' }, // quyền chưa biết → máy chủ quyết
    ]);
    const allDenied = assignCard({ rows: [row(1, { allowed: false })], defaultMode: 'one' });
    expect(computeAssign(allDenied, initialAssignState(allDenied)).canConfirm).toBe(false);
  });

  it('dòng bỏ / đã đúng người không bao giờ được gửi', () => {
    const card = assignCard({
      rows: [row(1), row(2, { current: LINH }), row(3)],
      defaultMode: 'one',
    });
    const c = computeAssign(card, { ...initialAssignState(card), overrides: { i3: SKIP } });
    expect(assignInputs(c)).toEqual([{ issueId: 'i1', version: 1, assigneeId: 'u-linh' }]);
  });
});

describe('assignOutcome / undoOutcome — chỉ khôi phục phần đã đổi', () => {
  const card = assignCard({
    rows: [row(1, { current: person('old1') }), row(2), row(3)],
    defaultMode: 'one',
  });
  const computed = computeAssign(card, initialAssignState(card));
  const sent = computed.rows.filter((r) => r.status === 'ok');

  it('lỗi một phần: chỉ dòng ok vào Hoàn tác (kèm người cũ + version mới); bỏ qua/lỗi báo rõ lý do', () => {
    const out = assignOutcome(sent, {
      results: [
        {
          issueId: 'i1',
          key: 'DEMO-1',
          status: 'ok',
          previousAssigneeId: 'old1',
          assigneeId: 'u-linh',
          version: 2,
        },
        {
          issueId: 'i2',
          key: 'DEMO-2',
          status: 'skipped',
          reason: 'Việc đã được sửa',
          previousAssigneeId: null,
          assigneeId: null,
          version: 7,
        },
        {
          issueId: 'i3',
          key: 'DEMO-3',
          status: 'failed',
          reason: 'Dự án đã lưu trữ',
          previousAssigneeId: null,
          assigneeId: null,
          version: 1,
        },
      ],
    });
    expect(out.counts).toEqual({ ok: 1, skipped: 1, failed: 1 });
    expect(out.title).toBe('Đã giao 1 việc (bỏ qua 1, lỗi 1)');
    expect(out.undo).toEqual({
      kind: 'assign',
      rows: [{ issueId: 'i1', version: 2, assigneeId: 'old1' }],
      labels: { i1: 'DEMO-1 · Việc 1' },
    });
    expect(out.rows.map((r) => r.reason)).toEqual([
      undefined,
      'Việc đã được sửa',
      'Dự án đã lưu trữ',
    ]);
  });

  it('máy chủ không trả một dòng → coi là lỗi (không im lặng); không dòng nào đổi → không có Hoàn tác', () => {
    const out = assignOutcome(sent, { results: [] });
    expect(out.counts.failed).toBe(3);
    expect(out.undo).toBeNull();
  });

  it('kết quả Hoàn tác đếm dòng đã hoàn tác và dòng bị người khác sửa sau đó', () => {
    const out = undoOutcome(
      {
        kind: 'assign',
        rows: [
          { issueId: 'i1', version: 2, assigneeId: 'old1' },
          { issueId: 'i2', version: 2, assigneeId: null },
        ],
        labels: { i1: 'A', i2: 'B' },
      },
      {
        results: [
          {
            issueId: 'i1',
            key: 'A',
            status: 'ok',
            previousAssigneeId: 'u-linh',
            assigneeId: 'old1',
            version: 3,
          },
          {
            issueId: 'i2',
            key: 'B',
            status: 'skipped',
            reason: 'Việc đã được sửa',
            previousAssigneeId: null,
            assigneeId: null,
            version: 9,
          },
        ],
      },
    );
    expect(out.counts).toEqual({ ok: 1, skipped: 1, failed: 0 });
    expect(out.title).toContain('Đã hoàn tác 1 dòng');
    expect(out.title).toContain('đã bị sửa sau đó');
    expect(out.undo).toBeNull();
  });
});

/* ------------------------------ thành viên ------------------------------ */

const ROLES = [
  { id: 'r-dev', name: 'Developer' },
  { id: 'r-tester', name: 'Tester' },
  { id: 'r-admin', name: 'Project Admin' },
];
function memberCard(over: Partial<MemberCard> = {}): MemberCard {
  return {
    kind: 'add-member',
    slots: [slot(LINH), slot(AN)],
    unmatched: [],
    projects: [
      {
        id: 'p1',
        key: 'DEMO',
        name: 'Demo',
        isPrivate: false,
        allowed: true,
        members: {
          'u-linh': { roleIds: ['r-dev'], roleNames: ['Developer'], isOverride: false },
          'u-an': { roleIds: ['r-tester'], roleNames: ['Tester'], isOverride: true },
        },
      },
      {
        id: 'p2',
        key: 'SECRET',
        name: 'Bí mật',
        isPrivate: true,
        allowed: true,
        members: { 'u-an': { roleIds: ['r-dev'], roleNames: ['Developer'], isOverride: true } },
      },
    ],
    groupName: null,
    roles: ROLES,
    adminRoleIds: ['r-admin'],
    actor: { id: 'u-me', orgAdmin: false },
    defaultRole: { id: 'r-tester', source: 'parsed', query: 'Tester' },
    info: [],
    notes: [],
    problems: [],
    ...over,
  };
}
const mrows = (c: ReturnType<typeof computeMembers>) =>
  c.rows.map((r) => `${r.person.id}|${r.project.key}:${r.status}`);

describe('computeMembers — thêm', () => {
  it('M2 "thêm" = HỢP vai trò: giữ vai trò đang có (riêng hoặc mặc định) và thêm vai trò đã chọn; đã có thì "đã có"', () => {
    const card = memberCard();
    const c = computeMembers(card, initialMemberState(card));
    expect(mrows(c)).toEqual([
      'u-linh|DEMO:ok', // mặc định Developer → riêng [Developer, Tester]
      'u-an|DEMO:already', // đã Tester (riêng)
      'u-linh|SECRET:ok', // chưa là thành viên dự án riêng tư → thêm [Tester]
      'u-an|SECRET:ok', // Developer riêng → [Developer, Tester]
    ]);
    expect(c.rows[0]!.set).toEqual(['r-dev', 'r-tester']);
    expect(c.rows[0]!.note).toContain('Giữ vai trò mặc định Developer, thêm Tester');
    expect(c.rows[2]!.set).toEqual(['r-tester']);
    expect(c.rows[2]!.note).toBe('Thêm vào dự án riêng tư.');
    expect(c.rows[3]!.set).toEqual(['r-dev', 'r-tester']);
    expect(c.rows[3]!.after).toBe('Developer, Tester');
    expect(c.canConfirm).toBe(true);
  });

  it('M2: người đang có [Project Admin, Tester] + thêm Developer → [Project Admin, Tester, Developer], KHÔNG mất vai trò quản trị', () => {
    const card = memberCard({
      slots: [slot(LINH)],
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: false,
          allowed: true,
          members: {
            'u-linh': {
              roleIds: ['r-admin', 'r-tester'],
              roleNames: ['Project Admin', 'Tester'],
              isOverride: true,
            },
          },
        },
      ],
    });
    const c = computeMembers(card, { ...initialMemberState(card), roleId: 'r-dev' });
    expect(c.rows[0]).toMatchObject({ status: 'ok', after: 'Project Admin, Tester, Developer' });
    expect(memberInputs(card, c)).toEqual([
      {
        projectId: 'p1',
        userId: 'u-linh',
        expect: ['r-admin', 'r-tester'],
        set: ['r-admin', 'r-tester', 'r-dev'],
      },
    ]);
  });

  it('bộ chọn vai trò: đổi vai trò thì trạng thái "đã có" đổi theo; chưa chọn vai trò → khoá xác nhận', () => {
    const card = memberCard({ defaultRole: { id: null, source: 'none' } });
    const st = initialMemberState(card);
    expect(st.roleId).toBeNull(); // L2: không điền sẵn
    const none = computeMembers(card, st);
    expect(none.canConfirm).toBe(false);
    expect(none.blocking).toContain('Chọn vai trò cho người được thêm.');
    expect(memberInputs(card, none)).toEqual([]);
    const dev = computeMembers(card, { ...st, roleId: 'r-dev' });
    expect(mrows(dev)).toEqual([
      'u-linh|DEMO:already',
      'u-an|DEMO:ok',
      'u-linh|SECRET:ok',
      'u-an|SECRET:already',
    ]);
  });

  it('dự án không đủ quyền (project:admin) → dòng bị khoá và KHÔNG vào yêu cầu gửi', () => {
    const card = memberCard();
    card.projects[1]!.allowed = false;
    const c = computeMembers(card, initialMemberState(card));
    expect(mrows(c).filter((r) => r.includes('SECRET'))).toEqual([
      'u-linh|SECRET:no-perm',
      'u-an|SECRET:no-perm',
    ]);
    const inputs = memberInputs(card, c);
    expect(inputs.every((i) => i.projectId === 'p1')).toBe(true);
    expect(inputs).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: null, set: ['r-dev', 'r-tester'] },
    ]);
  });

  it('yêu cầu gửi mang expect = vai trò RIÊNG đang thấy (null nếu chưa có) để máy chủ so lại', () => {
    const card = memberCard();
    const st = { ...initialMemberState(card), roleId: 'r-dev' };
    const inputs = memberInputs(card, computeMembers(card, st));
    expect(inputs).toEqual([
      { projectId: 'p1', userId: 'u-an', expect: ['r-tester'], set: ['r-tester', 'r-dev'] },
      { projectId: 'p2', userId: 'u-linh', expect: null, set: ['r-dev'] },
    ]);
  });

  it('tên mơ hồ → chọn người; người từ team hiện "qua team"; bỏ dòng', () => {
    const card = memberCard({
      slots: [{ query: 'Thuỷ', person: null, options: [THUY1, THUY2] }, slot(LINH, { via: 'QA' })],
    });
    const st = initialMemberState(card);
    const c = computeMembers(card, st);
    expect(c.canConfirm).toBe(false);
    expect(c.unresolvedChoices).toEqual(['Thuỷ']);
    expect(c.rows.every((r) => r.via === 'QA')).toBe(true);
    const picked = computeMembers(card, { ...st, picks: { Thuỷ: 'u-t1' } });
    expect(picked.rows.some((r) => r.person.id === 'u-t1')).toBe(true);
    expect(picked.canConfirm).toBe(true);
    const dropped = computeMembers(card, {
      ...st,
      picks: { Thuỷ: 'u-t1' },
      dropped: ['u-t1|p1', 'u-t1|p2'],
    });
    expect(dropped.rows.filter((r) => r.status === 'skip')).toHaveLength(2);
  });
});

describe('computeMembers — gỡ', () => {
  const removeCard = () =>
    memberCard({ kind: 'remove-member', roles: [], defaultRole: { id: null, source: 'none' } });
  it('chỉ gỡ được vai trò RIÊNG; mặc định theo tổ chức / chưa là thành viên → nói rõ, không ghi', () => {
    const card = removeCard();
    const c = computeMembers(card, initialMemberState(card));
    expect(mrows(c)).toEqual([
      'u-linh|DEMO:nothing', // chỉ có vai trò mặc định theo tổ chức
      'u-an|DEMO:ok', // vai trò riêng → gỡ
      'u-linh|SECRET:nothing', // chưa là thành viên
      'u-an|SECRET:ok', // dự án riêng tư: gỡ khỏi dự án
    ]);
    expect(c.rows[0]!.note).toContain('mặc định của tổ chức');
    expect(c.rows[1]!.after).toBe('Về vai trò mặc định của tổ chức');
    expect(c.rows[3]!.after).toBe('Rời dự án');
    expect(memberInputs(card, c)).toEqual([
      { projectId: 'p1', userId: 'u-an', expect: ['r-tester'], set: null },
      { projectId: 'p2', userId: 'u-an', expect: ['r-dev'], set: null },
    ]);
  });
  it('không có dòng nào gỡ được → không xác nhận được', () => {
    const card = removeCard();
    card.slots = [slot(LINH)];
    const c = computeMembers(card, initialMemberState(card));
    expect(c.canConfirm).toBe(false);
    expect(c.blocking).toContain('Không có dòng nào cần ghi.');
  });
});

describe('membersOutcome / Hoàn tác thành viên', () => {
  it('chỉ dòng ok vào Hoàn tác: expect = trạng thái SAU, set = trạng thái TRƯỚC; lỗi một phần không bị đụng', () => {
    const card = memberCard();
    const sent = computeMembers(card, initialMemberState(card)).rows.filter(
      (r) => r.status === 'ok',
    );
    const out = membersOutcome(card, sent, {
      results: [
        { projectId: 'p1', userId: 'u-linh', status: 'ok', before: null, after: ['r-tester'] },
        {
          projectId: 'p2',
          userId: 'u-linh',
          status: 'failed',
          reason: 'Chỉ Quản trị mới cấp quyền quản trị.',
          before: null,
          after: null,
        },
        { projectId: 'p2', userId: 'u-an', status: 'ok', before: ['r-dev'], after: ['r-tester'] },
      ],
    });
    expect(out.counts).toEqual({ ok: 2, skipped: 0, failed: 1 });
    expect(out.undo).toMatchObject({
      kind: 'members',
      rows: [
        { projectId: 'p1', userId: 'u-linh', expect: ['r-tester'], set: null },
        { projectId: 'p2', userId: 'u-an', expect: ['r-tester'], set: ['r-dev'] },
      ],
    });
    expect(out.rows[1]!.reason).toMatch(/Chỉ Quản trị/);
    const undone = undoOutcome(out.undo!, {
      results: [
        { projectId: 'p1', userId: 'u-linh', status: 'ok', before: ['r-tester'], after: null },
        {
          projectId: 'p2',
          userId: 'u-an',
          status: 'skipped',
          reason: 'Vai trò của người này đã đổi sau lúc xem trước.',
          before: ['r-admin'],
          after: ['r-admin'],
        },
      ],
    });
    expect(undone.counts).toEqual({ ok: 1, skipped: 1, failed: 0 });
  });
});

describe('M1 — chặn tự khoá mình / bỏ quản trị viên cuối (thẻ)', () => {
  const adminCard = (over: Partial<MemberCard> = {}): MemberCard =>
    memberCard({
      kind: 'remove-member',
      defaultRole: { id: null, source: 'none' },
      slots: [slot(person('u-me', 'Tôi')), slot(LINH)],
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: false,
          allowed: true,
          members: {
            'u-me': { roleIds: ['r-admin'], roleNames: ['Project Admin'], isOverride: true },
            'u-linh': { roleIds: ['r-admin'], roleNames: ['Project Admin'], isOverride: true },
          },
        },
      ],
      ...over,
    });
  it('gỡ CHÍNH MÌNH khỏi quyền quản trị → dòng "Bị chặn" kèm lý do; không vào yêu cầu gửi; người khác vẫn gỡ được', () => {
    const card = adminCard();
    const c = computeMembers(card, initialMemberState(card));
    expect(mrows(c)).toEqual(['u-me|DEMO:blocked', 'u-linh|DEMO:ok']);
    expect(c.rows[0]!.note).toContain('tự bỏ quyền quản trị của chính mình');
    expect(c.rows[0]!.note).toContain('quản trị viên khác');
    expect(memberInputs(card, c)).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: ['r-admin'], set: null },
    ]);
    expect(c.counts.blocked).toBe(1);
  });
  it('thêm vai trò thấp cho chính mình KHÔNG bị chặn (hợp vai trò, quản trị vẫn còn); Quản trị không bị chặn', () => {
    const add = memberCard({
      slots: [slot(person('u-me', 'Tôi'))],
      projects: adminCard().projects,
    });
    const c = computeMembers(add, { ...initialMemberState(add), roleId: 'r-dev' });
    expect(c.rows[0]!.status).toBe('ok');
    const orgAdmin = adminCard({ actor: { id: 'u-me', orgAdmin: true } });
    expect(mrows(computeMembers(orgAdmin, initialMemberState(orgAdmin)))).toEqual([
      'u-me|DEMO:ok',
      'u-linh|DEMO:ok',
    ]);
  });
  it('DỰ ÁN RIÊNG TƯ: gỡ quản trị viên cuối bị chặn (cộng dồn theo thứ tự); công khai thì không', () => {
    const priv = adminCard({
      slots: [slot(LINH), slot(AN)],
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: true,
          allowed: true,
          members: {
            'u-linh': { roleIds: ['r-admin'], roleNames: ['Project Admin'], isOverride: true },
            'u-an': { roleIds: ['r-admin'], roleNames: ['Project Admin'], isOverride: true },
          },
        },
      ],
    });
    const c = computeMembers(priv, initialMemberState(priv));
    expect(mrows(c)).toEqual(['u-linh|DEMO:ok', 'u-an|DEMO:blocked']);
    expect(c.rows[1]!.note).toContain('không còn quản trị viên nào');
    const pub = adminCard({
      slots: [slot(LINH), slot(AN)],
      projects: [{ ...priv.projects[0]!, isPrivate: false }],
    });
    expect(mrows(computeMembers(pub, initialMemberState(pub)))).toEqual([
      'u-linh|DEMO:ok',
      'u-an|DEMO:ok',
    ]);
  });
});

describe('L5 — chỉ có issue:edit:own', () => {
  it('dòng nói rõ "chỉ được sửa việc của mình"', () => {
    const card = assignCard({
      rows: [row(1, { allowed: false, ownOnly: true })],
      defaultMode: 'one',
    });
    const c = computeAssign(card, initialAssignState(card));
    expect(c.rows[0]!.note).toBe('Bạn chỉ được sửa việc của mình — không đủ quyền giao việc.');
    expect(c.canConfirm).toBe(false);
  });
});

describe('Team theo dự án — thêm / gỡ chỉ đụng vai trò gán trực tiếp', () => {
  const teamMember = (over: Record<string, unknown> = {}) => ({
    roleIds: ['r-dev', 'r-tester'],
    roleNames: ['Developer', 'Tester'],
    isOverride: true,
    directRoleIds: ['r-tester'],
    directRoleNames: ['Tester'],
    teamRoleIds: ['r-dev'],
    teamNames: ['QA'],
    ...over,
  });
  const withMembers = (kind: MemberCard['kind'], members: Record<string, unknown>): MemberCard =>
    memberCard({
      kind,
      slots: [slot(LINH)],
      roles: ROLES,
      defaultRole:
        kind === 'add-member'
          ? { id: 'r-admin', source: 'parsed', query: 'Admin' }
          : { id: null, source: 'none' },
      projects: [
        {
          id: 'p1',
          key: 'DEMO',
          name: 'Demo',
          isPrivate: false,
          allowed: true,
          members: members as MemberCard['projects'][number]['members'],
        },
      ],
    });

  it('thêm: giữ vai trò trực tiếp, KHÔNG đặt lại vai trò nhờ team; expect = phần trực tiếp', () => {
    const card = withMembers('add-member', { 'u-linh': teamMember() });
    const c = computeMembers(card, initialMemberState(card));
    expect(c.rows[0]!.status).toBe('ok');
    expect(c.rows[0]!.set).toEqual(['r-tester', 'r-admin']);
    expect(c.rows[0]!.note).toContain('team QA');
    expect(memberInputs(card, c)).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: ['r-tester'], set: ['r-tester', 'r-admin'] },
    ]);
  });

  it('thêm vai trò đang có CHỈ nhờ team: vẫn ghi trực tiếp (không báo "đã có")', () => {
    const card = withMembers('add-member', {
      'u-linh': teamMember({
        roleIds: ['r-dev'],
        roleNames: ['Developer'],
        directRoleIds: [],
        directRoleNames: [],
      }),
    });
    card.defaultRole = { id: 'r-dev', source: 'parsed', query: 'Developer' };
    const c = computeMembers(card, initialMemberState(card));
    expect(c.rows[0]!.status).toBe('ok');
    expect(c.rows[0]!.set).toEqual(['r-dev']);
    expect(memberInputs(card, c)[0]!.expect).toBeNull();
  });

  it('gỡ: còn team → chỉ gỡ phần trực tiếp, ghi rõ "vẫn có quyền qua team"', () => {
    const card = withMembers('remove-member', { 'u-linh': teamMember() });
    const c = computeMembers(card, initialMemberState(card));
    expect(c.rows[0]!.status).toBe('ok');
    expect(c.rows[0]!.viaTeams).toEqual(['QA']);
    expect(c.rows[0]!.after).toContain('team QA');
    expect(memberInputs(card, c)).toEqual([
      { projectId: 'p1', userId: 'u-linh', expect: ['r-tester'], set: null },
    ]);
  });

  it('gỡ: chỉ có quyền qua team → via-team, không ghi, không xác nhận được', () => {
    const card = withMembers('remove-member', {
      'u-linh': teamMember({
        roleIds: ['r-dev'],
        roleNames: ['Developer'],
        directRoleIds: [],
        directRoleNames: [],
      }),
    });
    const c = computeMembers(card, initialMemberState(card));
    expect(c.rows[0]!.status).toBe('via-team');
    expect(c.rows[0]!.note).toContain('Vẫn có quyền qua team QA');
    expect(c.counts.viaTeam).toBe(1);
    expect(c.canConfirm).toBe(false);
    expect(memberInputs(card, c)).toEqual([]);
  });

  it('quản trị nhờ team vẫn tính là quản trị: gỡ phần trực tiếp không bị chặn "quản trị cuối"', () => {
    const base = withMembers('remove-member', {
      'u-linh': teamMember({
        roleIds: ['r-admin', 'r-tester'],
        roleNames: ['Project Admin', 'Tester'],
        directRoleIds: ['r-admin', 'r-tester'],
        directRoleNames: ['Project Admin', 'Tester'],
        teamRoleIds: ['r-admin'],
      }),
    });
    base.projects[0]!.isPrivate = true;
    const c = computeMembers(base, initialMemberState(base));
    expect(c.rows[0]!.status).toBe('ok');
    // Không có team: cùng dữ liệu bị chặn (quản trị viên cuối của dự án riêng tư).
    const solo = withMembers('remove-member', {
      'u-linh': teamMember({
        roleIds: ['r-admin'],
        roleNames: ['Project Admin'],
        directRoleIds: ['r-admin'],
        directRoleNames: ['Project Admin'],
        teamRoleIds: [],
        teamNames: [],
      }),
    });
    solo.projects[0]!.isPrivate = true;
    expect(computeMembers(solo, initialMemberState(solo)).rows[0]!.status).toBe('blocked');
  });

  it('kết quả gỡ còn team: không tính là đã gỡ; Hoàn tác khôi phục đúng phần trực tiếp', () => {
    const card = withMembers('remove-member', { 'u-linh': teamMember() });
    const sent = computeMembers(card, initialMemberState(card)).rows.filter(
      (r) => r.status === 'ok',
    );
    const out = membersOutcome(card, sent, {
      results: [
        {
          projectId: 'p1',
          userId: 'u-linh',
          status: 'ok',
          before: ['r-tester'],
          after: null,
          stillViaTeams: ['QA'],
        },
      ],
    });
    expect(out.title).toContain('Đã gỡ vai trò riêng của 0 dòng');
    expect(out.title).toContain('1 vẫn có quyền qua team');
    expect(out.rows[0]!.viaTeams).toEqual(['QA']);
    expect(out.undo).toMatchObject({
      rows: [{ projectId: 'p1', userId: 'u-linh', expect: null, set: ['r-tester'] }],
    });
  });
});
