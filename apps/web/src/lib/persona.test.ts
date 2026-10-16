import { describe, expect, it } from 'vitest';
import { emptyHomeActions, personaOf } from './persona';

const m = (...names: string[]) => [{ roles: names.map((name) => ({ name })) }];
const can =
  (...keys: string[]) =>
  (p: string) =>
    keys.includes(p);

describe('personaOf', () => {
  it('tester ưu tiên hơn dev khi có cả hai vai trò', () =>
    expect(personaOf(m('Developer', 'Tester'), can())).toBe('tester'));
  it('Reviewer cũng là tester', () => expect(personaOf(m('Reviewer'), can())).toBe('tester'));
  it('BA/PO/SM → ba', () => {
    for (const r of ['Business Analyst', 'Product Owner', 'Scrum Master'])
      expect(personaOf(m(r), can())).toBe('ba');
  });
  it('tester ưu tiên hơn ba', () =>
    expect(personaOf(m('Business Analyst', 'Tester'), can())).toBe('tester'));
  it('Developer/DevOps/Designer/Workspace Member → dev', () => {
    for (const r of ['Developer', 'DevOps', 'Designer', 'Workspace Member'])
      expect(personaOf(m(r), can())).toBe('dev');
  });
  it('không có vai trò dự án: suy theo quyền', () => {
    expect(personaOf([], can('issue:triage'))).toBe('tester');
    expect(personaOf([], can('issue:triage', 'issue:assign'))).toBe('dev');
    expect(personaOf([], can('sprint:manage', 'issue:assign'))).toBe('ba');
    expect(personaOf([], can())).toBe('dev');
  });
  it('vai trò mặc định (chỉ Workspace Member) + quyền triage không gán → vẫn suy theo quyền', () => {
    expect(personaOf(m('Workspace Member'), can('issue:triage'))).toBe('tester');
  });
  it('vai trò dev tường minh thắng suy luận theo quyền', () => {
    expect(personaOf(m('Developer'), can('issue:triage'))).toBe('dev');
  });
});

describe('emptyHomeActions', () => {
  it('dev: nút chính "Nhận việc từ Việc chờ" trỏ tới Việc chờ dự án hiện tại', () => {
    const r = emptyHomeActions('dev', { projectKey: 'WM', canCreateProject: false });
    expect(r.actions[0]).toMatchObject({
      label: 'Nhận việc từ Việc chờ',
      kind: 'link',
      to: '/p/WM/backlog',
      primary: true,
    });
  });
  it('tester: nút chính "Báo lỗi"', () =>
    expect(
      emptyHomeActions('tester', { projectKey: 'WM', canCreateProject: false }).actions[0],
    ).toMatchObject({ label: 'Báo lỗi', kind: 'report-bug' }));
  it('ba: nút chính "Viết yêu cầu mới" (tạo công việc)', () =>
    expect(
      emptyHomeActions('ba', { projectKey: 'WM', canCreateProject: false }).actions[0],
    ).toMatchObject({ label: 'Viết yêu cầu mới', kind: 'create-issue' }));
  it('chưa có dự án: giải thích; chỉ có nút Tạo dự án khi được phép', () => {
    const none = emptyHomeActions('dev', { projectKey: null, canCreateProject: false });
    expect(none.actions).toEqual([]);
    expect(none.title).toBe('Bạn chưa thuộc dự án nào');
    expect(none.description).toContain('quản trị viên');
    expect(
      emptyHomeActions('dev', { projectKey: null, canCreateProject: true }).actions[0],
    ).toMatchObject({ kind: 'create-project' });
  });
  it('mọi persona có tiêu đề + mô tả tiếng Việt; id hành động duy nhất', () => {
    for (const p of ['dev', 'tester', 'ba'] as const) {
      const r = emptyHomeActions(p, { projectKey: 'WM', canCreateProject: true });
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      expect(new Set(r.actions.map((a) => a.id)).size).toBe(r.actions.length);
    }
  });
});
