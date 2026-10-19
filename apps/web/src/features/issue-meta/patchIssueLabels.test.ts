import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { keys } from '@/lib/queryKeys';
import { patchIssueLabels } from './patchIssueSets';

const lab = (id: string, name: string) => ({ id, projectId: 'p1', name, color: null });
const issue = (over: Partial<IssueDto> = {}) =>
  ({
    id: 'i1',
    key: 'P-1',
    projectId: 'p1',
    version: 7,
    labels: [lab('l1', 'a')],
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
  return { qc, i };
}
const detail = (qc: QueryClient) => qc.getQueryData<IssueDto>(keys.issues.byKey('P-1'))!;
const add = (l: ReturnType<typeof lab>) => (x: IssueDto) => ({ labels: [...x.labels, l] });
const drop = (id: string) => (x: IssueDto) => ({ labels: x.labels.filter((l) => l.id !== id) });

describe('patchIssueLabels — vá lạc quan nhãn của một việc', () => {
  it('vá chi tiết, danh sách dự án, board; không đổi version; không đụng việc khác', () => {
    const { qc, i } = setup();
    patchIssueLabels(qc, i, add(lab('tmp', 'mới')), drop('tmp'));
    expect(detail(qc).labels.map((l) => l.id)).toEqual(['l1', 'tmp']);
    expect(detail(qc).version).toBe(7);
    expect(qc.getQueryData<IssueDto[]>(keys.issues.byProject('p1'))![0]!.labels).toHaveLength(2);
    expect(qc.getQueryData<IssueDto[]>(keys.issues.byProject('p1'))![1]!.labels).toHaveLength(1);
    expect(qc.getQueryData<IssueDto[]>(keys.issues.byBoard('b1'))![0]!.labels).toHaveLength(2);
  });
  it('hoàn lại khi lỗi (phép ngược) ở mọi cache', () => {
    const { qc, i } = setup();
    const undo = patchIssueLabels(qc, i, add(lab('tmp', 'mới')), drop('tmp'));
    undo();
    expect(detail(qc).labels.map((l) => l.id)).toEqual(['l1']);
    expect(qc.getQueryData<IssueDto[]>(keys.issues.byBoard('b1'))![0]!.labels).toHaveLength(1);
  });
  it('thay chip tạm bằng nhãn thật khi máy chủ trả về', () => {
    const { qc, i } = setup();
    patchIssueLabels(qc, i, add(lab('tmp', 'mới')), drop('tmp'));
    patchIssueLabels(
      qc,
      i,
      (x) => ({ labels: x.labels.map((l) => (l.id === 'tmp' ? lab('real', 'mới') : l)) }),
      (x) => ({ labels: x.labels.filter((l) => l.id !== 'real') }),
    );
    expect(detail(qc).labels.map((l) => l.id)).toEqual(['l1', 'real']);
  });
});
