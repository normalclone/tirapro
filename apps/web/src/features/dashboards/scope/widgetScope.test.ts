import { describe, expect, it } from 'vitest';
import {
  aggregateIds,
  dataScopeSummary,
  issueListJql,
  resolveScope,
  scopeInfoOf,
  scopeLabel,
  widgetInfoOf,
  type DashboardScopeInfo,
  type WidgetScopeInfo,
} from './widgetScope';

const A = { id: 'pa', key: 'AAA', name: 'Alpha' };
const B = { id: 'pb', key: 'BBB', name: 'Beta' };

const dash = (over: Partial<DashboardScopeInfo> = {}): DashboardScopeInfo => ({
  dataScope: 'GROUP',
  scopeProjects: [A, B],
  programName: 'Đối tác',
  ...over,
});
const info = (
  d: DashboardScopeInfo,
  projectIds: string[] | null,
  inherits = true,
): WidgetScopeInfo => ({ dashboard: d, inherits, projectIds });

describe('resolveScope', () => {
  it('ô tự đặt dự án thắng mọi phạm vi (cách cũ)', () => {
    expect(resolveScope(info(dash(), ['pa', 'pb']), { projectId: 'px' })).toEqual({
      kind: 'project',
      projectId: 'px',
    });
  });

  it('không có ngữ cảnh dashboard hoặc phạm vi toàn tổ chức (projectIds null) → org', () => {
    expect(resolveScope(null, {})).toEqual({ kind: 'org' });
    expect(resolveScope(info(dash({ dataScope: 'ORG', scopeProjects: null }), null), {})).toEqual({
      kind: 'org',
    });
  });

  it('phạm vi một dự án mà người xem thấy → project; không thấy → projects RỖNG (không rơi về org)', () => {
    const one = dash({ dataScope: 'PROJECT', scopeProjects: [A] });
    expect(resolveScope(info(one, ['pa']), {})).toEqual({ kind: 'project', projectId: 'pa' });
    expect(resolveScope(info(dash({ dataScope: 'PROJECT', scopeProjects: [] }), []), {})).toEqual({
      kind: 'projects',
      ids: [],
    });
  });

  it('nhóm dự án → projects với đúng danh sách (kể cả 1 dự án hoặc rỗng — vẫn là nhóm)', () => {
    expect(resolveScope(info(dash(), ['pa', 'pb']), {})).toEqual({
      kind: 'projects',
      ids: ['pa', 'pb'],
    });
    expect(resolveScope(info(dash(), ['pa']), {})).toEqual({ kind: 'projects', ids: ['pa'] });
    expect(resolveScope(info(dash({ scopeProjects: [] }), []), {})).toEqual({
      kind: 'projects',
      ids: [],
    });
  });
});

describe('aggregateIds', () => {
  it('org → null (không lọc); project → [id]; projects → danh sách, rỗng giữ nguyên là rỗng', () => {
    expect(aggregateIds({ kind: 'org' })).toBeNull();
    expect(aggregateIds({ kind: 'project', projectId: 'p' })).toEqual(['p']);
    expect(aggregateIds({ kind: 'projects', ids: [] })).toEqual([]);
  });
});

describe('issueListJql', () => {
  const g = info(dash(), ['pa', 'pb']);
  it('toàn tổ chức → nguyên văn', () => {
    expect(issueListJql('assignee = currentUser()', { kind: 'org' }, null)).toBe(
      'assignee = currentUser()',
    );
  });
  it('nhóm → project IN (mã dự án trong phạm vi) AND (…), giữ ORDER BY', () => {
    expect(
      issueListJql(
        'assignee = currentUser() ORDER BY updated DESC',
        { kind: 'projects', ids: ['pa', 'pb'] },
        g,
      ),
    ).toBe('project IN ("AAA", "BBB") AND (assignee = currentUser()) ORDER BY updated DESC');
  });
  it('chỉ mã của dự án NGƯỜI XEM thấy (id không có trong scopeProjects bị bỏ)', () => {
    expect(issueListJql('a = 1', { kind: 'projects', ids: ['pa', 'ghost'] }, g)).toContain(
      'project IN ("AAA")',
    );
  });
  it('phạm vi RỖNG → null (ô phải trống, không chạy JQL không giới hạn)', () => {
    expect(
      issueListJql(
        'assignee = currentUser()',
        { kind: 'projects', ids: [] },
        info(dash({ scopeProjects: [] }), []),
      ),
    ).toBeNull();
    expect(issueListJql('x', { kind: 'projects', ids: ['pa'] }, null)).toBeNull();
  });
});

describe('scopeLabel / dataScopeSummary', () => {
  it('ô kế thừa: nhóm kèm tên + số dự án; một dự án kèm mã; toàn tổ chức', () => {
    const g = info(dash(), ['pa', 'pb']);
    expect(scopeLabel(g, resolveScope(g, {}))).toBe('Nhóm Đối tác · 2 dự án');
    const p = info(dash({ dataScope: 'PROJECT', scopeProjects: [A], programName: null }), ['pa']);
    expect(scopeLabel(p, resolveScope(p, {}))).toBe('Dự án AAA');
    const o = info(dash({ dataScope: 'ORG', scopeProjects: null }), null);
    expect(scopeLabel(o, resolveScope(o, {}))).toBe('Toàn tổ chức');
  });
  it('ô tự đặt dự án nói rõ là riêng; nhóm đã xoá / không xem được dự án nói đúng', () => {
    const own = info(dash(), ['pa'], false);
    expect(scopeLabel(own, { kind: 'project', projectId: 'pa' }, 'AAA')).toBe('Dự án AAA (riêng)');
    const gone = info(dash({ programName: null, scopeProjects: [] }), []);
    expect(scopeLabel(gone, resolveScope(gone, {}))).toBe('Nhóm đã bị xoá');
    const hidden = info(dash({ dataScope: 'PROJECT', scopeProjects: [] }), []);
    expect(scopeLabel(hidden, resolveScope(hidden, {}))).toBe('Dự án bạn không xem được');
    expect(scopeLabel(null, { kind: 'org' })).toBeNull();
  });
  it('dataScopeSummary cho tiêu đề trang', () => {
    expect(
      dataScopeSummary({ dataScope: 'ORG', scopeProjects: null, scopeProgramName: null }),
    ).toBe('Toàn tổ chức');
    expect(
      dataScopeSummary({ dataScope: 'PROJECT', scopeProjects: [A], scopeProgramName: null }),
    ).toBe('Dự án AAA · Alpha');
    expect(
      dataScopeSummary({ dataScope: 'GROUP', scopeProjects: [A, B], scopeProgramName: 'Đối tác' }),
    ).toBe('Nhóm Đối tác · 2 dự án bạn xem được');
    expect(
      dataScopeSummary({ dataScope: 'GROUP', scopeProjects: [], scopeProgramName: null }),
    ).toBe('Nhóm đã bị xoá — chọn lại');
  });
});

describe('widgetInfoOf / scopeInfoOf', () => {
  const d = scopeInfoOf({ dataScope: 'GROUP', scopeProjects: [A, B], scopeProgramName: 'Đối tác' });
  it('không có dashboard → null', () => expect(widgetInfoOf(null, {})).toBeNull());
  it('chế độ soạn: ô kế thừa lấy danh sách của bảng, ô có dự án riêng lấy [dự án đó]', () => {
    expect(widgetInfoOf(d, {})).toMatchObject({ inherits: true, projectIds: ['pa', 'pb'] });
    expect(widgetInfoOf(d, { projectId: 'px' })).toMatchObject({
      inherits: false,
      projectIds: ['px'],
    });
  });
  it('ưu tiên danh sách máy chủ đã giải (kể cả [] và null)', () => {
    expect(widgetInfoOf(d, {}, { inherits: true, projectIds: [] })?.projectIds).toEqual([]);
    expect(widgetInfoOf(d, {}, { inherits: true, projectIds: null })?.projectIds).toBeNull();
  });
});
