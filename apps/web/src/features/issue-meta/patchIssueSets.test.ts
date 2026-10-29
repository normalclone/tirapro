import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { applyIssueSets, patchIssueSets } from './patchIssueSets';
import { withComponent, withoutComponent } from './issueSets';

const API = { id: 'a', name: 'API' };
const WEB = { id: 'w', name: 'Web' };

const issue = (over: Partial<IssueDto> = {}) =>
  ({
    id: 'i1',
    key: 'P-1',
    projectId: 'p1',
    version: 7,
    components: [],
    fixVersions: [],
    ...over,
  }) as unknown as IssueDto;

function setup() {
  const qc = new QueryClient();
  const i = issue();
  qc.setQueryData(keys.issues.byKey('P-1'), i);
  qc.setQueryData(keys.issues.byProject('p1'), [i, issue({ id: 'i2', key: 'P-2' })]);
  qc.setQueryData(keys.issues.byBoard('b1'), [i]);
  qc.setQueryData(keys.issues.byBoard('b2'), [issue({ id: 'i9', key: 'P-9' })]);
  return { qc, i };
}
const detail = (qc: QueryClient) => qc.getQueryData<IssueDto>(keys.issues.byKey('P-1'))!;
const list = (qc: QueryClient) => qc.getQueryData<IssueDto[]>(keys.issues.byProject('p1'))!;
const board = (qc: QueryClient, b: string) => qc.getQueryData<IssueDto[]>(keys.issues.byBoard(b))!;
const attach = (c: typeof API) => (x: IssueDto) => ({
  components: withComponent(x.components, c),
  fixVersions: x.fixVersions,
});
const detach = (id: string) => (x: IssueDto) => ({
  components: withoutComponent(x.components, id),
  fixVersions: x.fixVersions,
});

describe('patchIssueSets (B18)', () => {
  it('vá chi tiết + danh sách dự án + board chứa việc; KHÔNG đổi version; không đụng việc khác', () => {
    const { qc, i } = setup();
    patchIssueSets(qc, i, attach(API), detach('a'));
    expect(detail(qc).components).toEqual([API]);
    expect(detail(qc).version).toBe(7);
    expect(list(qc)[0]!.components).toEqual([API]);
    expect(list(qc)[0]!.version).toBe(7);
    expect(list(qc)[1]!.components).toEqual([]);
    expect(board(qc, 'b1')[0]!.components).toEqual([API]);
    expect(board(qc, 'b2')[0]!.components).toEqual([]);
  });

  it('hoàn lại (undo) khi lỗi: trả về tập cũ ở mọi cache, version nguyên', () => {
    const { qc, i } = setup();
    const undo = patchIssueSets(qc, i, attach(API), detach('a'));
    undo();
    expect(detail(qc).components).toEqual([]);
    expect(list(qc)[0]!.components).toEqual([]);
    expect(board(qc, 'b1')[0]!.components).toEqual([]);
    expect(detail(qc).version).toBe(7);
  });

  it('hai thao tác liên tiếp, thao tác đầu lỗi => chỉ lùi thao tác đó, giữ bản vá của thao tác sau', () => {
    const { qc, i } = setup();
    const undo1 = patchIssueSets(qc, i, attach(API), detach('a'));
    patchIssueSets(qc, i, attach(WEB), detach('w'));
    undo1();
    expect(detail(qc).components).toEqual([WEB]);
    expect(list(qc)[0]!.components).toEqual([WEB]);
  });

  it('không tạo cache mới khi chưa có', () => {
    const qc = new QueryClient();
    patchIssueSets(qc, issue(), attach(API), detach('a'));
    expect(qc.getQueryData(keys.issues.byKey('P-1'))).toBeUndefined();
    expect(qc.getQueryData(keys.issues.byProject('p1'))).toBeUndefined();
  });
});

describe('applyIssueSets (realtime issue:sets_changed)', () => {
  it('thay thẳng tập theo id ở mọi cache, không đổi version; idempotent', () => {
    const { qc } = setup();
    const p = {
      issueId: 'i1',
      issueKey: 'P-1',
      projectId: 'p1',
      components: [API, WEB],
      fixVersions: [{ id: 'v', name: 'v1.0', type: 'FIX' as const }],
    };
    applyIssueSets(qc, p);
    applyIssueSets(qc, p);
    expect(detail(qc).components).toEqual([API, WEB]);
    expect(detail(qc).fixVersions).toHaveLength(1);
    expect(detail(qc).version).toBe(7);
    expect(list(qc)[0]!.components).toEqual([API, WEB]);
    expect(list(qc)[1]!.components).toEqual([]);
    expect(board(qc, 'b1')[0]!.fixVersions).toHaveLength(1);
  });
});
