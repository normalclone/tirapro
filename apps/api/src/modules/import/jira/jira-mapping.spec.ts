import { describe, expect, it } from 'vitest';
import { parseJiraCsv } from './jira-csv.parser';
import {
  findMissingMapping,
  formatMissing,
  inferPriorityRank,
  inferStatusCategory,
  isEpicTypeName,
  isSubtaskTypeName,
  layerIssues,
  resolveLinks,
} from './jira-mapping';

const csv = (rows: string[]) =>
  parseJiraCsv(['Summary,Issue key,Issue id,Issue Type,Parent,Custom field (Epic Link)', ...rows].join('\n'));
const isEpic = (r: { issueType: string }) => isEpicTypeName(r.issueType);
const isSub = (r: { issueType: string }) => isSubtaskTypeName(r.issueType);

describe('resolveLinks / layerIssues', () => {
  it('Jira Cloud mới: story có Parent = epic → thành epic, không phải việc cha', () => {
    const { issues } = csv(['E,P-1,1,Epic,,', 'S,P-2,2,Story,P-1,', 'T,P-3,3,Sub-task,2,']);
    const links = resolveLinks(issues, isEpic, isSub);
    const [e, s, t] = issues;
    expect(links.get(s!)).toMatchObject({ parent: null, epic: e });
    expect(links.get(t!)).toMatchObject({ parent: s, epic: null });
    const layers = layerIssues(issues, links, isEpic, isSub);
    expect(layers.map((l) => l.map((r) => r.key))).toEqual([['P-1'], ['P-2'], ['P-3']]);
  });

  it('tham chiếu ngoài tệp → cảnh báo, không liên kết; tự tham chiếu bị bỏ', () => {
    const { issues } = csv(['A,P-1,1,Task,P-99,E-5', 'B,P-2,2,Task,P-2,']);
    const links = resolveLinks(issues, isEpic, isSub);
    expect(links.get(issues[0]!)!.warnings).toHaveLength(2);
    expect(links.get(issues[0]!)!.parent).toBeNull();
    expect(links.get(issues[1]!)!.parent).toBeNull();
  });

  it('vòng cha-con không làm treo, mọi dòng đều được xếp tầng', () => {
    const { issues } = csv(['A,P-1,1,Task,P-2,', 'B,P-2,2,Task,P-1,']);
    const links = resolveLinks(issues, isEpic, isSub);
    const layers = layerIssues(issues, links, isEpic, isSub);
    expect(layers.flat()).toHaveLength(2);
  });

  it('subtask luôn đứng sau mọi việc thường, kể cả khi cha là việc độc lập', () => {
    const { issues } = csv(['A,P-1,1,Task,,', 'S,P-2,2,Sub-task,P-1,', 'B,P-3,3,Task,,']);
    const layers = layerIssues(issues, resolveLinks(issues, isEpic, isSub), isEpic, isSub);
    expect(layers.map((l) => l.map((r) => r.key))).toEqual([['P-1', 'P-3'], ['P-2']]);
  });
});

describe('mapping helpers', () => {
  it('findMissingMapping / formatMissing', () => {
    const m = findMissingMapping(
      { issueTypes: ['Bug'], statuses: ['Done', 'QA'], priorities: ['High'] },
      { issueTypes: { Bug: 'x' }, statuses: { Done: 'y' }, priorities: {}, users: {} },
    );
    expect(m).toEqual({ issueTypes: [], statuses: ['QA'], priorities: ['High'] });
    expect(formatMissing(m)).toContain('trạng thái: QA');
  });

  it('suy category trạng thái và rank ưu tiên theo tên', () => {
    expect(inferStatusCategory('Done')).toBe('DONE');
    expect(inferStatusCategory('Closed')).toBe('DONE');
    expect(inferStatusCategory('To Do')).toBe('TODO');
    expect(inferStatusCategory('In Review')).toBe('IN_PROGRESS');
    expect(inferPriorityRank('Highest')).toBeGreaterThan(inferPriorityRank('High'));
    expect(inferPriorityRank('Lowest')).toBeLessThan(inferPriorityRank('Low'));
  });
});
