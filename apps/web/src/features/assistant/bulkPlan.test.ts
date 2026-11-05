import { describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { parseBulkAddMember, parseBulkAssign, parseBulkRemoveMember } from './bulkParse';
import {
  planBulkAddMember,
  planBulkAssign,
  planBulkRemoveMember,
  planNeedsChoice,
  approximateMatches,
  planResolvedNothing,
  resolvePeopleNames,
  targetProjects,
  type BulkActor,
} from './bulkPlan';
import { ENV, META, PEOPLE, issue, makeDeps, ok } from './fixtures';

const ACTOR: BulkActor = { id: 'u-me', displayName: 'Tôi Là Mình', email: 'me@x.vn' };

const sub = (n: number, over: Record<string, unknown> = {}) =>
  issue({
    id: `i-sub-${n}`,
    key: `DEMO-SUB-${n}`,
    summary: `Việc ${n}`,
    type: { id: 't-sub', name: 'Sub-task', key: 'SUBTASK' },
    assignee: null,
    ...over,
  });

/** Kho việc giả theo mã. */
function store(list: IssueDto[]) {
  const byKey = new Map(list.map((i) => [i.key, i]));
  return {
    getIssue: vi.fn((k: string) => Promise.resolve(byKey.get(k) ?? null)),
    getProjectIssues: vi.fn(() => Promise.resolve(list)),
  };
}

const assign = (text: string) => parseBulkAssign(text)!;

describe('planBulkAssign — tìm việc', () => {
  it('danh sách / dải mã: giữ thứ tự mã, mã không thấy (hoặc không có quyền xem) vào missingKeys', async () => {
    const deps = makeDeps(store([sub(11), sub(12), sub(14)]));
    const plan = await planBulkAssign(assign('giao DEMO-SUB-11..14 cho An'), ENV, deps, ACTOR);
    expect(plan.issues.map((i) => i.key)).toEqual(['DEMO-SUB-11', 'DEMO-SUB-12', 'DEMO-SUB-14']);
    expect(plan.missingKeys).toEqual(['DEMO-SUB-13']);
    expect(plan.filterJql).toBeNull();
    expect(plan.distribution).toBe('one');
  });

  it('lấy từng mã với tối đa 8 lời gọi song song (không bắn 200 yêu cầu cùng lúc)', async () => {
    let live = 0;
    let peak = 0;
    const deps = makeDeps({
      getIssue: async (k: string) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live--;
        return sub(Number(k.split('-').pop()));
      },
    });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1..40 cho An'), ENV, deps, ACTOR);
    expect(plan.issues).toHaveLength(40);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('việc con của một việc: theo parentId; của Epic thì theo epicId; cha không thấy → missingKeys', async () => {
    const parent = issue({ id: 'i-parent', key: 'DEMO-TASK-12' });
    const epic = issue({
      id: 'i-epic',
      key: 'DEMO-EPIC-1',
      type: { id: 't-epic', name: 'Epic', key: 'EPIC' },
    });
    const list = [
      parent,
      epic,
      sub(1, { parentId: 'i-parent' }),
      sub(2, { parentId: 'i-parent' }),
      sub(3, { parentId: 'other' }),
      issue({ id: 'i-story', key: 'DEMO-STORY-1', epicId: 'i-epic', parentId: null }),
    ];
    const deps = makeDeps(store(list));
    const a = await planBulkAssign(
      assign('giao việc con của DEMO-TASK-12 cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(a.issues.map((i) => i.key)).toEqual(['DEMO-SUB-1', 'DEMO-SUB-2']);
    expect(a.filterNotes).toEqual(['Việc con của DEMO-TASK-12']);
    const b = await planBulkAssign(
      assign('giao việc con của DEMO-EPIC-1 cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(b.issues.map((i) => i.key)).toEqual(['DEMO-STORY-1']);
    const c = await planBulkAssign(
      assign('giao việc con của DEMO-TASK-99 cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(c.issues).toEqual([]);
    expect(c.missingKeys).toEqual(['DEMO-TASK-99']);
  });
});

describe('planBulkAssign — bộ lọc nhẹ', () => {
  it('dịch sang JQL (hiện trên thẻ), lọc tiếp tiêu đề "bắt đầu bằng", dùng tên loại THẬT của tổ chức', async () => {
    const searchJql = vi.fn(() =>
      Promise.resolve({
        items: [
          sub(1, { summary: '[Test] Đăng nhập' }),
          sub(2, { summary: 'Sửa [Test] sai' }),
          sub(3, { summary: '[test] Lưu' }),
        ],
        hasMore: false,
      }),
    );
    const deps = makeDeps({
      searchJql,
      getMeta: ok({
        ...META,
        issueTypes: [{ id: 't-sub', name: 'Việc phụ', key: 'SUBTASK', isSubtask: true }],
      }),
    });
    const plan = await planBulkAssign(
      assign('giao các sub-task [Test] chưa giao của DEMO cho Linh'),
      ENV,
      deps,
      ACTOR,
    );
    expect(searchJql).toHaveBeenCalledWith(
      'project = "DEMO" AND type = "Việc phụ" AND assignee IS EMPTY AND summary ~ "Test" ORDER BY key ASC',
    );
    expect(plan.filterJql).toContain('assignee IS EMPTY');
    expect(plan.issues.map((i) => i.key)).toEqual(['DEMO-SUB-1', 'DEMO-SUB-3']); // "Sửa [Test]" bị loại
    expect(plan.filterNotes).toEqual([
      'dự án DEMO',
      'việc con (Sub-task)',
      'chưa giao cho ai',
      'tiêu đề bắt đầu bằng [Test]',
    ]);
    expect(plan.truncated).toBe(false);
  });

  it('kết quả còn nhiều hơn một trang → truncated (thẻ phải nói rõ, không giả vờ đủ)', async () => {
    const deps = makeDeps({ searchJql: ok({ items: [sub(1)], hasMore: true }) });
    const plan = await planBulkAssign(
      assign('giao các việc chưa giao của DEMO cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(plan.truncated).toBe(true);
  });

  it('không nêu dự án → dùng dự án đang xem; ngoài dự án → từ chối, KHÔNG quét cả tổ chức', async () => {
    const searchJql = vi.fn(() => Promise.resolve({ items: [], hasMore: false }));
    const deps = makeDeps({ searchJql });
    await planBulkAssign(assign('giao các việc chưa giao cho An'), ENV, deps, ACTOR);
    expect(searchJql).toHaveBeenCalledWith(expect.stringContaining('project = "DEMO"'));
    searchJql.mockClear();
    const plan = await planBulkAssign(
      assign('giao các việc chưa giao cho An'),
      { ...ENV, project: null },
      deps,
      ACTOR,
    );
    expect(searchJql).not.toHaveBeenCalled();
    expect(plan.problems.join(' ')).toMatch(/cần một dự án/);
  });

  it('dự án không thấy / mơ hồ → báo lỗi, không tìm', async () => {
    const searchJql = vi.fn(() => Promise.resolve({ items: [], hasMore: false }));
    const deps = makeDeps({ searchJql });
    const none = await planBulkAssign(
      assign('giao các việc chưa giao của ZZZ cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(none.problems.join(' ')).toMatch(/Không thấy dự án “ZZZ”/);
    const env2 = {
      ...ENV,
      projects: [...ENV.projects, { id: 'p3', key: 'DEMO2', name: 'Demo hai' }],
    };
    const amb = await planBulkAssign(
      assign('giao các việc chưa giao của DEM cho An'),
      env2,
      deps,
      ACTOR,
    );
    expect(amb.problems.join(' ')).toMatch(/khớp nhiều dự án/);
    expect(searchJql).not.toHaveBeenCalled();
  });

  it('Epic theo mã: lọc theo epicId trên việc của dự án, không dùng JQL; Epic không thấy → lỗi', async () => {
    const epic = issue({
      id: 'i-epic',
      key: 'DEMO-EPIC-1',
      type: { id: 't-epic', name: 'Epic', key: 'EPIC' },
    });
    const list = [
      epic,
      sub(1, { epicId: 'i-epic' }),
      sub(2, { epicId: 'i-epic', assignee: { id: 'u-an', displayName: 'An' } }),
      sub(3, { epicId: 'x' }),
    ];
    const searchJql = vi.fn();
    const deps = makeDeps({ ...store(list), searchJql });
    const plan = await planBulkAssign(
      assign('giao các việc thuộc epic DEMO-EPIC-1 chưa giao cho Linh'),
      ENV,
      deps,
      ACTOR,
    );
    expect(plan.issues.map((i) => i.key)).toEqual(['DEMO-SUB-1']);
    expect(plan.filterJql).toBeNull();
    expect(plan.filterNotes).toContain('thuộc Epic DEMO-EPIC-1');
    expect(searchJql).not.toHaveBeenCalled();
    const miss = await planBulkAssign(
      assign('giao các việc thuộc epic DEMO-EPIC-9 cho Linh'),
      ENV,
      deps,
      ACTOR,
    );
    expect(miss.problems.join(' ')).toMatch(/Không thấy Epic DEMO-EPIC-9/);
  });

  it('lệnh không hiểu phạm vi việc → không tìm gì, giữ lỗi cú pháp', async () => {
    const deps = makeDeps();
    const plan = await planBulkAssign(assign('giao 12 cho An'), ENV, deps, ACTOR);
    expect(plan.issues).toEqual([]);
    expect(plan.problems.join(' ')).toMatch(/chưa hiểu/);
    expect(deps.calls).not.toContain('searchJql');
    expect(deps.calls).not.toContain('getIssue');
  });
});

describe('planBulkAssign — người nhận và cách chia mặc định', () => {
  const base = store([sub(1), sub(2)]);
  it('một người → "one"; nhiều người → "round-robin"', async () => {
    const deps = makeDeps(base);
    expect(
      (await planBulkAssign(assign('giao DEMO-SUB-1, 2 cho Linh'), ENV, deps, ACTOR)).distribution,
    ).toBe('one');
    expect(
      (await planBulkAssign(assign('giao DEMO-SUB-1, 2 cho Linh, An'), ENV, deps, ACTOR))
        .distribution,
    ).toBe('round-robin');
  });
  it('tên mơ hồ → status ambiguous kèm các lựa chọn; planNeedsChoice = true', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1, 2 cho Thuỷ'),
      ENV,
      makeDeps(base),
      ACTOR,
    );
    expect(plan.people[0]).toMatchObject({ status: 'ambiguous' });
    expect(planNeedsChoice(plan)).toBe(true);
  });
  it('khớp rõ → planNeedsChoice = false; "tôi" là người gõ', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1, 2 cho tôi'),
      ENV,
      makeDeps(base),
      ACTOR,
    );
    expect(plan.people[0]).toMatchObject({ status: 'ok', value: { id: 'u-me' } });
    expect(planNeedsChoice(plan)).toBe(false);
  });
  it('"Minh" (không dấu) là TÊN NGƯỜI, không phải "mình"', async () => {
    const deps = makeDeps({
      ...base,
      getPeople: ok([...PEOPLE, { id: 'u-minh', displayName: 'Trần Minh' }]),
    });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1 cho Minh'), ENV, deps, ACTOR);
    expect(plan.people[0]).toMatchObject({ status: 'ok', value: { id: 'u-minh' } });
  });
  it('tên không có trong danh sách đã tải → thử tìm phía máy chủ đúng một lần; vẫn không thấy → none', async () => {
    const searchPeople = vi.fn((q: string) =>
      Promise.resolve(
        q === 'Quỳnh' ? [{ id: 'u-q', displayName: 'Quỳnh Vũ', email: 'q@x.vn' }] : [],
      ),
    );
    const deps = makeDeps({ ...base, searchPeople });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1 cho Quỳnh, Zzz'), ENV, deps, ACTOR);
    expect(plan.people.map((p) => p.status)).toEqual(['ok', 'none']);
    expect(searchPeople).toHaveBeenCalledTimes(2);
  });
  it('lỗi tìm người phía máy chủ không làm vỡ kế hoạch (coi như không thấy)', async () => {
    const deps = makeDeps({ ...base, searchPeople: () => Promise.reject(new Error('offline')) });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1 cho Zzz'), ENV, deps, ACTOR);
    expect(plan.people[0]).toMatchObject({ status: 'none' });
  });
  it('cùng một người nêu hai lần (tên + email) chỉ giữ một', async () => {
    const out = await resolvePeopleNames(['Linh', 'linh@x.vn'], ACTOR, makeDeps());
    expect(out).toHaveLength(1);
  });
});

describe('planBulkAssign — theo cặp', () => {
  it('mỗi việc kèm người của nó; việc không thấy vào missingKeys; mơ hồ giữ riêng từng cặp', async () => {
    const deps = makeDeps(store([sub(11), sub(12)]));
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-11 cho Linh, DEMO-SUB-12 cho Thuỷ, DEMO-SUB-13 cho An'),
      ENV,
      deps,
      ACTOR,
    );
    expect(plan.distribution).toBe('pairs');
    expect(plan.pairs?.map((p) => [p.issue.key, p.person.status])).toEqual([
      ['DEMO-SUB-11', 'ok'],
      ['DEMO-SUB-12', 'ambiguous'],
    ]);
    expect(plan.missingKeys).toEqual(['DEMO-SUB-13']);
    expect(planNeedsChoice(plan)).toBe(true);
  });
  it('một người xuất hiện ở nhiều cặp vẫn được khớp cho từng cặp', async () => {
    const deps = makeDeps(store([sub(1), sub(2)]));
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh, DEMO-SUB-2 cho Linh'),
      ENV,
      deps,
      ACTOR,
    );
    expect(plan.pairs?.map((p) => p.person.status)).toEqual(['ok', 'ok']);
  });
});

const add = (t: string) => parseBulkAddMember(t)!;
const rem = (t: string) => parseBulkRemoveMember(t)!;

describe('planBulkAddMember', () => {
  it('người + dự án + vai trò đều khớp', async () => {
    const plan = await planBulkAddMember(
      add('thêm Linh, Hương vào DEMO, ALPHA với vai trò Tester'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(plan.candidates.map((c) => c.person.id)).toEqual(['u-linh', 'u-huong']);
    expect(plan.projects.map((p) => p.status)).toEqual(['ok', 'ok']);
    expect(plan.role).toMatchObject({ status: 'ok', value: { id: 'r-tester' } });
    expect(plan.problems).toEqual([]);
    expect(planNeedsChoice(plan)).toBe(false);
    expect(targetProjects(plan).map((p) => p.key)).toEqual(['DEMO', 'ALPHA']);
  });
  it('không nói vai trò → role = null (thẻ cho chọn), không phải lỗi', async () => {
    const plan = await planBulkAddMember(add('thêm Linh vào DEMO'), ENV, makeDeps(), ACTOR);
    expect(plan.role).toBeNull();
    expect(planNeedsChoice(plan)).toBe(false);
  });
  it('vai trò không có → lỗi + cần chọn; không tải vai trò khi không nêu vai trò', async () => {
    const deps = makeDeps();
    const none = await planBulkAddMember(add('thêm Linh vào DEMO vai trò Khách'), ENV, deps, ACTOR);
    expect(none.role?.status).toBe('none');
    expect(none.problems.join(' ')).toMatch(/Không thấy vai trò “Khách”/);
    expect(planNeedsChoice(none)).toBe(true);
    const deps2 = makeDeps();
    await planBulkAddMember(add('thêm Linh vào DEMO'), ENV, deps2, ACTOR);
    expect(deps2.calls).not.toContain('getProjectRoles');
  });
  it('người mơ hồ và dự án không thấy → cần chọn / báo lỗi', async () => {
    const plan = await planBulkAddMember(add('thêm Thuỷ vào DEMO, ZZZ'), ENV, makeDeps(), ACTOR);
    expect(plan.people[0]).toMatchObject({ status: 'ambiguous' });
    expect(plan.projects.map((p) => p.status)).toEqual(['ok', 'none']);
    expect(plan.problems.join(' ')).toMatch(/Không thấy dự án “ZZZ”/);
    expect(planNeedsChoice(plan)).toBe(true);
  });
  it('team của tổ chức: thành viên của team thành ứng viên (via=team); người nêu tên trực tiếp thắng khi trùng', async () => {
    const plan = await planBulkAddMember(
      add('thêm Nhóm QA và Bình vào DEMO vai trò Tester'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    // QA = Linh, Bình; Bình nêu tên trực tiếp nên không bị tính "qua team".
    expect(plan.candidates).toEqual([
      { person: PEOPLE[1], via: null },
      { person: PEOPLE[2], via: { teamId: 't-qa', teamName: 'QA' } },
    ]);
    expect(plan.teams[0]).toMatchObject({ status: 'ok' });
  });
  it('team không thấy / team rỗng → báo lỗi', async () => {
    const none = await planBulkAddMember(add('thêm Nhóm Dev vào DEMO'), ENV, makeDeps(), ACTOR);
    expect(none.problems.join(' ')).toMatch(/Không thấy team “Dev”/);
    const empty = await planBulkAddMember(
      add('thêm Nhóm QA vào DEMO'),
      ENV,
      makeDeps({ getTeams: ok([{ id: 't-qa', name: 'QA', members: [] }]) }),
      ACTOR,
    );
    expect(empty.problems.join(' ')).toMatch(/chưa có thành viên/);
  });
  it('nhóm dự án CÁ NHÂN: chỉ dự án đang hoạt động mà người gõ xem được (bỏ đã lưu trữ và dự án ngoài tầm xem)', async () => {
    const env = { ...ENV, projects: [ENV.projects[0]!] }; // chỉ thấy DEMO; ALPHA không thấy, OLD lưu trữ
    const plan = await planBulkAddMember(
      add('thêm Hương vào mọi dự án nhóm Thanh Hóa của tôi'),
      env,
      makeDeps(),
      ACTOR,
    );
    expect(plan.group).toMatchObject({ status: 'ok', value: { id: 'g-th' } });
    expect(plan.groupProjects.map((p) => p.key)).toEqual(['DEMO']);
    expect(targetProjects(plan).map((p) => p.key)).toEqual(['DEMO']);
  });
  it('nhóm không phải của mình → không thấy; nhóm rỗng → báo; gộp nhóm + dự án nêu tên không trùng', async () => {
    const none = await planBulkAddMember(
      add('thêm Hương vào nhóm Hà Nội của tôi'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(none.problems.join(' ')).toMatch(/chưa có nhóm dự án tên “Hà Nội”/);
    expect(none.group?.status).toBe('none');
    const empty = await planBulkAddMember(
      add('thêm Hương vào nhóm Rỗng của tôi'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(empty.problems.join(' ')).toMatch(/chưa có dự án nào đang hoạt động/);
    const both = await planBulkAddMember(
      add('thêm Hương vào DEMO và nhóm Thanh Hóa của tôi'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(
      targetProjects(both)
        .map((p) => p.key)
        .sort(),
    ).toEqual(['ALPHA', 'DEMO']);
  });
  it('chỉ tải dữ liệu cần thiết (không tải team/nhóm khi lệnh không nêu)', async () => {
    const deps = makeDeps();
    await planBulkAddMember(add('thêm Linh vào DEMO'), ENV, deps, ACTOR);
    expect(deps.calls).not.toContain('getTeams');
    expect(deps.calls).not.toContain('getMyGroups');
  });
});

describe('planBulkRemoveMember', () => {
  it('người + dự án + nhóm cá nhân', async () => {
    const plan = await planBulkRemoveMember(
      rem('gỡ Linh khỏi DEMO, ALPHA'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(plan.people[0]).toMatchObject({ status: 'ok', value: { id: 'u-linh' } });
    expect(targetProjects(plan).map((p) => p.key)).toEqual(['DEMO', 'ALPHA']);
    expect(planNeedsChoice(plan)).toBe(false);
    const g = await planBulkRemoveMember(
      rem('gỡ Linh khỏi mọi dự án nhóm Thanh Hóa của tôi'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(targetProjects(g).map((p) => p.key)).toEqual(['DEMO', 'ALPHA']);
  });
  it('tên mơ hồ → phải chọn; dự án không thấy → báo lỗi', async () => {
    const plan = await planBulkRemoveMember(rem('gỡ Thuỷ khỏi ZZZ'), ENV, makeDeps(), ACTOR);
    expect(planNeedsChoice(plan)).toBe(true);
    expect(plan.problems.join(' ')).toMatch(/Không thấy dự án “ZZZ”/);
  });
});

describe('fix round 1 — M2: khớp gần đúng lộ ra trong kế hoạch', () => {
  it('"Hươ" → Hương Đỗ là ok nhưng approx; không bắt chọn lại, vẫn được liệt kê để thẻ đánh dấu', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Hươ'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(plan.people[0]).toMatchObject({ status: 'ok', approx: true, value: { id: 'u-huong' } });
    expect(planNeedsChoice(plan)).toBe(false);
    expect(approximateMatches(plan)).toHaveLength(1);
  });
  it('tên đầy đủ / tên gọi: không approx; dự án/nhóm khớp một phần: approx', async () => {
    const exact = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(approximateMatches(exact)).toEqual([]);
    const deps = makeDeps({
      getMyGroups: ok([
        { id: 'g', name: 'QA Hà Nội', projects: [{ id: 'p1', key: 'DEMO', name: 'Demo' }] },
      ]),
    });
    const plan = await planBulkAddMember(
      add('thêm Linh vào mọi dự án nhóm QA của tôi'),
      ENV,
      deps,
      ACTOR,
    );
    expect(approximateMatches(plan).map((r) => r.query)).toEqual(['QA']);
  });
  it('tên 2 ký tự không khớp người nào ("Hà" không rơi vào "Phạm Hải")', async () => {
    const deps = makeDeps({
      ...store([sub(1)]),
      getPeople: ok([{ id: 'h', displayName: 'Phạm Hải' }]),
    });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1 cho Hà'), ENV, deps, ACTOR);
    expect(plan.people[0]).toMatchObject({ status: 'none' });
  });
});

describe('fix round 1 — L4: "nhóm QA" trần vừa là nhóm dự án vừa là team → hỏi lại', () => {
  const groups = ok([
    { id: 'g-qa', name: 'QA', projects: [{ id: 'p1', key: 'DEMO', name: 'Demo' }] },
  ]);
  it('trần "nhóm QA" khi cả nhóm dự án của mình và team QA đều có → groupVsTeam + phải chọn', async () => {
    const plan = await planBulkAddMember(
      add('thêm Linh vào nhóm QA'),
      ENV,
      makeDeps({ getMyGroups: groups }),
      ACTOR,
    );
    expect(plan.groupVsTeam).toMatchObject({ id: 't-qa' });
    expect(plan.problems.join(' ')).toMatch(/khớp cả nhóm dự án của bạn lẫn team/);
    expect(planNeedsChoice(plan)).toBe(true);
    const rem2 = await planBulkRemoveMember(
      rem('gỡ Linh khỏi nhóm QA'),
      ENV,
      makeDeps({ getMyGroups: groups }),
      ACTOR,
    );
    expect(planNeedsChoice(rem2)).toBe(true);
  });
  it('nói rõ "của tôi" → không hỏi; trần nhưng chỉ có nhóm dự án (không có team cùng tên) → không hỏi', async () => {
    const explicit = await planBulkAddMember(
      add('thêm Linh vào nhóm QA của tôi'),
      ENV,
      makeDeps({ getMyGroups: groups }),
      ACTOR,
    );
    expect(explicit.groupVsTeam).toBeNull();
    expect(planNeedsChoice(explicit)).toBe(false);
    const loose = await planBulkAddMember(
      add('thêm Linh vào nhóm Thanh Hóa'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(loose.groupVsTeam).toBeNull();
    expect(planNeedsChoice(loose)).toBe(false);
  });
});

describe('fix round 1 — planResolvedNothing / lỗi cú pháp chặn xem trước', () => {
  it('không khớp được gì → resolvedNothing; có một người khớp → không', async () => {
    const a = await planBulkAddMember(add('thêm Zzz vào ZZZ'), ENV, makeDeps(), ACTOR);
    expect(planResolvedNothing(a)).toBe(true);
    const b = await planBulkAddMember(add('thêm Linh vào ZZZ'), ENV, makeDeps(), ACTOR);
    expect(planResolvedNothing(b)).toBe(false);
    const c = await planBulkAssign(
      assign('giao DEMO-SUB-9 cho Zzz'),
      ENV,
      makeDeps(store([])),
      ACTOR,
    );
    expect(planResolvedNothing(c)).toBe(true);
    const d = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Zzz'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(planResolvedNothing(d)).toBe(false);
  });
  it('cặp sai cấu trúc → kế hoạch không có việc/người và phải sửa lệnh (planNeedsChoice)', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho An cho Linh'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(plan.issues).toEqual([]);
    expect(plan.people).toEqual([]);
    expect(plan.pairs).toBeNull();
    expect(planNeedsChoice(plan)).toBe(true);
  });
  it('H1 qua kế hoạch: "A cho Linh và B cho An" → mỗi việc đúng người', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh và DEMO-SUB-2 cho An'),
      ENV,
      makeDeps(store([sub(1), sub(2)])),
      ACTOR,
    );
    expect(
      plan.pairs?.map((p) => [p.issue.key, p.person.status === 'ok' ? p.person.value.id : '?']),
    ).toEqual([
      ['DEMO-SUB-1', 'u-linh'],
      ['DEMO-SUB-2', 'u-an'],
    ]);
  });
});

describe('T2 carry — R2 cặp trùng việc, L1 trần 200 người, "và các việc con", dự án-không-phải-người', () => {
  it('R2: cùng một việc nêu cho hai người khác nhau → problem, chặn xác nhận, chỉ giữ một dòng', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh, DEMO-SUB-1 cho An'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(plan.pairs).toHaveLength(1);
    expect(plan.problems.join(' ')).toMatch(/DEMO-SUB-1 được nêu cho hai người khác nhau/);
    expect(planNeedsChoice(plan)).toBe(true);
  });
  it('R2: cùng việc, cùng người (tên và email) → gộp, không báo lỗi', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh, DEMO-SUB-1 cho linh@x.vn'),
      ENV,
      makeDeps(store([sub(1)])),
      ACTOR,
    );
    expect(plan.pairs).toHaveLength(1);
    expect(plan.problems).toEqual([]);
  });
  it('L1: danh sách đã tải đầy (200) → LUÔN hỏi máy chủ và gộp, để lộ ứng viên thứ hai', async () => {
    const filler = Array.from({ length: 199 }, (_, i) => ({
      id: `f${i}`,
      displayName: `Người ${i}`,
    }));
    const searchPeople = vi.fn(() =>
      Promise.resolve([{ id: 'u-linh2', displayName: 'Linh Võ', email: 'linh2@x.vn' }]),
    );
    const full = makeDeps({
      ...store([sub(1)]),
      getPeople: ok([{ id: 'u-linh', displayName: 'Linh Phạm' }, ...filler]),
      searchPeople,
    });
    const plan = await planBulkAssign(assign('giao DEMO-SUB-1 cho Linh'), ENV, full, ACTOR);
    expect(searchPeople).toHaveBeenCalledTimes(1);
    expect(plan.people[0]!.status).toBe('ambiguous');
    // Chưa đầy → như cũ: một khớp thì không hỏi máy chủ.
    const spy = vi.fn(() => Promise.resolve([]));
    await planBulkAssign(
      assign('giao DEMO-SUB-1 cho Linh'),
      ENV,
      makeDeps({ ...store([sub(1)]), searchPeople: spy }),
      ACTOR,
    );
    expect(spy).not.toHaveBeenCalled();
  });
  it('"và các việc con": gồm việc con theo cha hoặc Epic, không trùng, kèm ghi chú', async () => {
    const parent = issue({ id: 'i-parent', key: 'DEMO-TASK-12' });
    const list = [
      parent,
      sub(1, { parentId: 'i-parent' }),
      sub(2, { parentId: 'i-parent' }),
      sub(3, { parentId: 'x' }),
    ];
    const plan = await planBulkAssign(
      assign('giao DEMO-TASK-12 và các việc con cho An'),
      ENV,
      makeDeps(store(list)),
      ACTOR,
    );
    expect(plan.issues.map((i) => i.key)).toEqual(['DEMO-TASK-12', 'DEMO-SUB-1', 'DEMO-SUB-2']);
    expect(plan.filterNotes).toEqual(['kèm việc con (thêm 2)']);
  });
  it('số lạc đi vào plan.notes (không chặn)', async () => {
    const plan = await planBulkAssign(
      assign('giao DEMO-SUB-1 và DEMO-SUB-2 trước ngày 15 cho An'),
      ENV,
      makeDeps(store([sub(1), sub(2)])),
      ACTOR,
    );
    expect(plan.notes[0]).toContain('bỏ qua số 15');
    expect(planNeedsChoice(plan)).toBe(false);
  });
  it('R4: "thêm DEMO vào nhóm … của tôi" → nói rõ DEMO là dự án, đưa dự án vào nhóm làm ở trang Dự án', async () => {
    const plan = await planBulkAddMember(
      add('thêm DEMO vào nhóm Thanh Hóa của tôi'),
      ENV,
      makeDeps(),
      ACTOR,
    );
    expect(plan.problems.join(' ')).toMatch(
      /“DEMO” là một dự án, không phải một người.*trang Dự án/,
    );
    expect(planNeedsChoice(plan)).toBe(true);
    expect(planResolvedNothing(plan)).toBe(false);
  });
});
