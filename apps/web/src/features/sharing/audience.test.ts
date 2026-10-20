import { describe, expect, it } from 'vitest';
import { AUDIENCE_AVATAR_LIMIT, activePeople, audienceView, splitPeople } from './audience';

const user = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `u${i}`,
  displayName: `Người ${i}`,
  avatarUrl: null,
  status: 'ACTIVE',
  ...extra,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => user(i + 1));

describe('activePeople', () => {
  it('bỏ người đã vô hiệu hoá, gộp trùng theo id, giữ thứ tự', () => {
    const out = activePeople([user(1), user(2, { status: 'DEACTIVATED' }), user(1), user(3)]);
    expect(out.map((p) => p.id)).toEqual(['u1', 'u3']);
    expect(out[0]).toEqual({ id: 'u1', name: 'Người 1', avatarUrl: null });
  });
  it('bỏ qua null/undefined (trưởng nhóm có thể trống)', () => {
    expect(activePeople([null, user(1), undefined]).map((p) => p.id)).toEqual(['u1']);
  });
});

describe('splitPeople — tối đa 5 avatar + "+N"', () => {
  it('giới hạn là 5', () => expect(AUDIENCE_AVATAR_LIMIT).toBe(5));
  it('đủ 5 → không có phần dư; 6 → +1; 12 → +7', () => {
    expect(splitPeople(activePeople(many(5)))).toMatchObject({ extra: 0 });
    expect(splitPeople(activePeople(many(5))).shown).toHaveLength(5);
    expect(splitPeople(activePeople(many(6)))).toMatchObject({ extra: 1 });
    const s = splitPeople(activePeople(many(12)));
    expect(s.shown.map((p) => p.id)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(s.extra).toBe(7);
  });
});

describe('audienceView — ai có quyền xem', () => {
  it('PRIVATE → "Chỉ bạn", không avatar', () => {
    const v = audienceView({ scope: 'PRIVATE' });
    expect(v.headline).toBe('Chỉ bạn'); // quản trị viên KHÔNG thấy mục riêng tư của người khác → không nhắc quản trị viên
    expect(v.headline).not.toContain('quản trị');
    expect(v.people).toEqual([]);
    expect(v.names).toBeNull();
  });
  it('GLOBAL → "Mọi thành viên không gian (N)" với N theo memberCount; API cũ không có N thì bỏ phần (N)', () => {
    expect(audienceView({ scope: 'GLOBAL', memberCount: 1234 }).headline).toBe(
      'Mọi thành viên không gian (1.234)',
    );
    expect(audienceView({ scope: 'GLOBAL' }).headline).toBe('Mọi thành viên không gian');
    expect(audienceView({ scope: 'GLOBAL', memberCount: 25 }).people).toEqual([]);
    expect(audienceView({ scope: 'GLOBAL', memberCount: 25 }).headline).not.toContain('quản trị'); // quản trị viên đã là thành viên
  });
  describe('TEAM', () => {
    it('chưa chọn nhóm → lời nhắc, không avatar', () => {
      const v = audienceView({ scope: 'TEAM', team: null });
      expect(v.headline).toBe('Chọn nhóm để xem ai có quyền');
      expect(v.people).toEqual([]);
    });
    it('trưởng nhóm + thành viên (không trùng, không vô hiệu hoá): avatar 5 + dư; N = tổng', () => {
      const lead = user(1);
      const members = [user(1), ...many(10).slice(1), user(99, { status: 'DEACTIVATED' })];
      const v = audienceView({ scope: 'TEAM', team: { name: 'Web', lead, members } });
      expect(v.headline).toBe('Thành viên nhóm Web (10) và quản trị viên không gian');
      expect(v.people).toHaveLength(5);
      expect(v.extra).toBe(5);
      expect(v.people[0]?.id).toBe('u1'); // trưởng nhóm đứng đầu
    });
    it('câu đọc cho trình đọc màn hình: tên 5 người đầu + "và N người khác"', () => {
      const v = audienceView({
        scope: 'TEAM',
        team: { name: 'Web', lead: null, members: many(7) },
      });
      expect(v.names).toBe('Gồm Người 1, Người 2, Người 3, Người 4, Người 5 và 2 người khác.');
    });
    it('đủ trong 5 người → liệt kê hết, không "và …"', () => {
      const v = audienceView({
        scope: 'TEAM',
        team: { name: 'Web', lead: null, members: many(2) },
      });
      expect(v.names).toBe('Gồm Người 1, Người 2.');
    });
  });
  describe('PROJECT', () => {
    it('chưa chọn dự án → lời nhắc', () => {
      expect(audienceView({ scope: 'PROJECT', project: null }).headline).toBe(
        'Chọn dự án để xem ai có quyền',
      );
    });
    it('dự án CÔNG KHAI → mọi thành viên CÓ QUYỀN XEM DỰ ÁN (người chỉ-theo-dự-án không thấy dự án công khai), không kèm số', () => {
      const v = audienceView({
        scope: 'PROJECT',
        memberCount: 25,
        project: { name: 'Web', isPrivate: false },
        projectMembers: { status: 'ready', people: activePeople(many(3)) },
      });
      expect(v.headline).toBe('Mọi thành viên có quyền xem dự án');
      expect(v.headline).not.toContain('25'); // số thành viên không gian ≠ số người thấy dự án
      expect(v.note).toBe('Dự án Web công khai nên mọi thành viên có quyền xem dự án đều thấy.');
      expect(v.people).toEqual([]);
    });
    it('dự án RIÊNG TƯ → thành viên dự án (avatar + N)', () => {
      const v = audienceView({
        scope: 'PROJECT',
        project: { name: 'Bí mật', isPrivate: true },
        projectMembers: { status: 'ready', people: activePeople(many(8)) },
      });
      expect(v.headline).toBe('Thành viên dự án Bí mật (8) và quản trị viên không gian');
      expect(v.people).toHaveLength(5);
      expect(v.extra).toBe(3);
      expect(v.note).toBe('Dự án riêng tư: chỉ thành viên dự án thấy.');
    });
    it('đang tải / lỗi danh sách thành viên → không (N), không avatar, có chú thích', () => {
      const base = { scope: 'PROJECT', project: { name: 'Bí mật', isPrivate: true } } as const;
      const loading = audienceView({ ...base, projectMembers: { status: 'loading', people: [] } });
      expect(loading.headline).toBe('Thành viên dự án Bí mật và quản trị viên không gian');
      expect(loading.note).toBe('Đang tải danh sách thành viên…');
      const failed = audienceView({ ...base, projectMembers: { status: 'error', people: [] } });
      expect(failed.headline).toBe('Thành viên dự án Bí mật và quản trị viên không gian');
      expect(failed.note).toBe('Không tải được danh sách thành viên.');
      expect(failed.people).toEqual([]);
    });
  });
});
