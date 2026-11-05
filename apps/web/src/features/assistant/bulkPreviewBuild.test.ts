import { describe, expect, it, vi } from 'vitest';
import { parseBulkAddMember, parseBulkAssign, parseBulkRemoveMember } from './bulkParse';
import { planBulk, type BulkActor } from './bulkPlan';
import { buildBulkCard } from './bulkPreviewBuild';
import type { AssignCard, MemberCard } from './bulkPreview';
import { ENV, issue, makeDeps, ok } from './fixtures';

const ACTOR: BulkActor = { id: 'u-me', displayName: 'Tôi', email: 'me@x.vn' };
const sub = (n: number, over: Record<string, unknown> = {}) =>
  issue({
    id: `i${n}`,
    key: `DEMO-SUB-${n}`,
    summary: `Việc ${n}`,
    version: n,
    assignee: null,
    storyPoints: null,
    ...over,
  });
const store = (...ns: number[]) => {
  const m = new Map(ns.map((n) => [`DEMO-SUB-${n}`, sub(n)]));
  return { getIssue: (k: string) => Promise.resolve(m.get(k) ?? null) };
};
const card = async (cmd: string, deps = makeDeps(store(1, 2, 3))) => {
  const intent = (parseBulkAssign(cmd) ?? parseBulkAddMember(cmd) ?? parseBulkRemoveMember(cmd))!;
  return buildBulkCard(await planBulk(intent, ENV, deps, ACTOR), ENV, deps);
};

describe('buildBulkCard — giao việc', () => {
  it('dòng mang version, dự án, người hiện tại (kèm email) và gợi ý quyền; ô tên mang email', async () => {
    const deps = makeDeps({
      getIssue: ok(sub(1, { assignee: { id: 'u-an', displayName: 'An Nguyễn' }, storyPoints: 5 })),
    });
    const c = (await card('giao DEMO-SUB-1 cho Linh', deps)) as AssignCard;
    expect(c.kind).toBe('assign');
    expect(c.rows[0]).toMatchObject({
      issueId: 'i1',
      version: 1,
      projectKey: 'DEMO',
      points: 5,
      allowed: true,
      current: { id: 'u-an', name: 'An Nguyễn', email: 'an@x.vn' },
    });
    expect(c.slots[0]!.person).toEqual({ id: 'u-linh', name: 'Phạm Linh', email: 'linh@x.vn' });
    expect(c.defaultMode).toBe('one');
  });

  it('quyền: thiếu issue:assign HOẶC issue:edit → allowed=false; chưa biết → undefined', async () => {
    const mk = (assign: boolean | undefined, edit: boolean | undefined) =>
      makeDeps({
        ...store(1),
        can: (_p, perm) => Promise.resolve(perm === 'issue:assign' ? assign : edit),
      });
    expect(
      ((await card('giao DEMO-SUB-1 cho Linh', mk(true, true))) as AssignCard).rows[0]!.allowed,
    ).toBe(true);
    expect(
      ((await card('giao DEMO-SUB-1 cho Linh', mk(true, false))) as AssignCard).rows[0]!.allowed,
    ).toBe(false);
    expect(
      ((await card('giao DEMO-SUB-1 cho Linh', mk(false, undefined))) as AssignCard).rows[0]!
        .allowed,
    ).toBe(false);
    expect(
      ((await card('giao DEMO-SUB-1 cho Linh', mk(true, undefined))) as AssignCard).rows[0]!
        .allowed,
    ).toBeUndefined();
    const rejects = makeDeps({ ...store(1), can: () => Promise.reject(new Error('x')) });
    expect(
      ((await card('giao DEMO-SUB-1 cho Linh', rejects)) as AssignCard).rows[0]!.allowed,
    ).toBeUndefined();
  });

  it('nhiều người → mặc định chia đều lần lượt + tải điểm đang giữ; một người → không tải', async () => {
    const getOpenLoad = vi.fn(() => Promise.resolve({ 'u-linh': 4, 'u-an': 9 }));
    const c = (await card(
      'giao DEMO-SUB-1..3 cho Linh, An',
      makeDeps({ ...store(1, 2, 3), getOpenLoad }),
    )) as AssignCard;
    expect(c.defaultMode).toBe('round-robin');
    expect(c.loads).toEqual({ 'u-linh': 4, 'u-an': 9 });
    const one = vi.fn(() => Promise.resolve({}));
    await card('giao DEMO-SUB-1 cho Linh', makeDeps({ ...store(1), getOpenLoad: one }));
    expect(one).not.toHaveBeenCalled();
    const broken = (await card(
      'giao DEMO-SUB-1..3 cho Linh, An',
      makeDeps({ ...store(1, 2, 3), getOpenLoad: () => Promise.reject(new Error('x')) }),
    )) as AssignCard;
    expect(broken.loads).toEqual({}); // lỗi tải điểm không làm vỡ thẻ
  });

  it('theo cặp → mode pairs + mỗi dòng có pairQuery; tên mơ hồ thành ô chọn (không có person)', async () => {
    const c = (await card(
      'giao DEMO-SUB-1 cho Linh, DEMO-SUB-2 cho Thuỷ',
      makeDeps(store(1, 2)),
    )) as AssignCard;
    expect(c.defaultMode).toBe('pairs');
    expect(c.modes[0]).toBe('pairs');
    expect(c.rows.map((r) => r.pairQuery)).toEqual(['Linh', 'Thuỷ']);
    const thuy = c.slots.find((s) => s.query === 'Thuỷ')!;
    expect(thuy.person).toBeNull();
    expect(thuy.options!.map((o) => o.email)).toEqual(['thuy.nguyen@x.vn', 'thuy.le@x.vn']);
  });

  it('khớp gần đúng được đánh dấu; tên không thấy vào unmatched; lỗi chặn đi vào problems; ghi chú không chặn vào notes', async () => {
    const c = (await card(
      'giao DEMO-SUB-1 và DEMO-SUB-2 trước ngày 15 cho Hươ, Zzz',
      makeDeps(store(1, 2)),
    )) as AssignCard;
    expect(c.slots[0]).toMatchObject({ approx: true, person: { id: 'u-huong' } });
    expect(c.unmatched).toEqual(['Zzz']);
    expect(c.notes[0]).toContain('bỏ qua số 15');
    expect(c.problems).toEqual([]);
    const dup = (await card(
      'giao DEMO-SUB-1 cho Linh, DEMO-SUB-1 cho An',
      makeDeps(store(1)),
    )) as AssignCard;
    expect(dup.problems.join(' ')).toMatch(/hai người khác nhau/);
  });

  it('không có việc nào hoặc không có người nào → không dựng thẻ (trả lời bằng chữ)', async () => {
    expect(await card('giao DEMO-SUB-9 cho Linh', makeDeps(store(1)))).toBeNull();
    expect(
      await card('giao DEMO-SUB-1 cho An nhé', makeDeps({ ...store(1), getPeople: ok([]) })),
    ).not.toBeNull(); // có tên không thấy → thẻ chặn
  });
});

describe('buildBulkCard — thêm / gỡ thành viên', () => {
  const members = (
    map: Record<
      string,
      { userId: string; roleIds: string[]; roleNames: string[]; isOverride: boolean }[]
    >,
  ) => ({ getProjectMembers: (pid: string) => Promise.resolve(map[pid] ?? []) });

  it('mỗi dự án một cột: quyền project:admin, riêng tư, thành viên hiện tại; vai trò từ lệnh', async () => {
    const env = { ...ENV, projects: [{ ...ENV.projects[0]!, isPrivate: true }, ENV.projects[1]!] };
    const deps = makeDeps({
      ...members({
        p1: [{ userId: 'u-linh', roleIds: ['r-dev'], roleNames: ['Developer'], isOverride: true }],
      }),
      can: (pid) => Promise.resolve(pid === 'p1'),
    });
    const intent = parseBulkAddMember('thêm Linh vào DEMO, ALPHA vai trò Tester')!;
    const c = (await buildBulkCard(
      await planBulk(intent, env, deps, ACTOR),
      env,
      deps,
    )) as MemberCard;
    expect(c.kind).toBe('add-member');
    expect(c.projects.map((p) => [p.key, p.isPrivate, p.allowed])).toEqual([
      ['DEMO', true, true],
      ['ALPHA', false, false],
    ]);
    expect(c.projects[0]!.members['u-linh']).toEqual({
      roleIds: ['r-dev'],
      roleNames: ['Developer'],
      isOverride: true,
    });
    expect(c.defaultRole).toEqual({ id: 'r-tester', source: 'parsed', query: 'Tester' });
  });

  it('không nói vai trò → mặc định Developer; vai trò không thấy → phải chọn (không chặn bằng lỗi)', async () => {
    const none = (await card('thêm Linh vào DEMO')) as MemberCard;
    expect(none.defaultRole).toMatchObject({ id: 'r-dev', source: 'default' });
    const bad = (await card('thêm Linh vào DEMO vai trò Khách')) as MemberCard;
    expect(bad.defaultRole).toEqual({ id: null, source: 'none' });
    expect(bad.info.join(' ')).toContain('Không thấy vai trò “Khách”');
    expect(bad.problems.join(' ')).not.toContain('vai trò');
  });

  it('team: thành viên thành từng ô tên "qua team"; nhóm dự án cá nhân: đích là dự án đang hoạt động', async () => {
    const c = (await card('thêm Nhóm QA vào mọi dự án nhóm Thanh Hóa của tôi')) as MemberCard;
    expect(c.slots.map((s) => [s.person?.id, s.via])).toEqual([
      ['u-linh', 'QA'],
      ['u-binh', 'QA'],
    ]);
    expect(c.projects.map((p) => p.key)).toEqual(['DEMO', 'ALPHA']);
    expect(c.groupName).toBe('Thanh Hóa');
    expect(c.info.join(' ')).toContain('Thanh Hóa');
  });

  it('không tải được thành viên của một dự án → lỗi chặn (không giả vờ biết trạng thái)', async () => {
    const deps = makeDeps({ getProjectMembers: () => Promise.reject(new Error('offline')) });
    const c = (await card('gỡ Linh khỏi DEMO', deps)) as MemberCard;
    expect(c.kind).toBe('remove-member');
    expect(c.problems.join(' ')).toContain('Không tải được thành viên dự án DEMO');
  });

  it('không có dự án hợp lệ → không dựng thẻ', async () => {
    expect(await card('thêm Linh vào ZZZ')).toBeNull();
  });
});
