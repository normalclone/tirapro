import { beforeEach, describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { finishIssueAction, runIssueAction, useIssueActionStore } from './issueActions';

const issue = (id: string) => ({ id, key: id.toUpperCase() }) as IssueDto;

describe('danh sách runner của host', () => {
  beforeEach(() => useIssueActionStore.setState({ runs: [] }));
  it('hai hành động liên tiếp ĐỀU còn (hành động sau không gạt hành động trước)', () => {
    runIssueAction({ kind: 'assignMe', issue: issue('a') });
    runIssueAction({ kind: 'delete', issue: issue('b') });
    const runs = useIssueActionStore.getState().runs;
    expect(runs.map((r) => r.kind)).toEqual(['assignMe', 'delete']);
    expect(new Set(runs.map((r) => r.seq)).size).toBe(2);
  });
  it('xong việc thì gỡ đúng runner đó, runner khác giữ nguyên', () => {
    runIssueAction({ kind: 'assignMe', issue: issue('a') });
    runIssueAction({ kind: 'delete', issue: issue('b') });
    const [first, second] = useIssueActionStore.getState().runs;
    finishIssueAction(first!.seq);
    expect(useIssueActionStore.getState().runs.map((r) => r.seq)).toEqual([second!.seq]);
    finishIssueAction(second!.seq);
    expect(useIssueActionStore.getState().runs).toEqual([]);
  });
  it('gỡ một seq không tồn tại không làm gì', () => {
    runIssueAction({ kind: 'assignMe', issue: issue('a') });
    finishIssueAction(999999);
    expect(useIssueActionStore.getState().runs).toHaveLength(1);
  });
});
