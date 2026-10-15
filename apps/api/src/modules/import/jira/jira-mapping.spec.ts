import { describe, expect, it } from 'vitest';
import { parseJiraCsv } from './jira-csv.parser';
import {
  findMissingMapping,
  formatMissing,
  formatUnmatchedAssignees,
  MAX_UNMATCHED_LISTED,
  inferPriorityRank,
  inferStatusCategory,
  isEpicTypeName,
  isSubtaskTypeName,
  layerIssues,
  resolveLinks,
  summarizeUnmatchedAssignees,
} from './jira-mapping';

const csv = (rows: string[]) =>
  parseJiraCsv(
    ['Summary,Issue key,Issue id,Issue Type,Parent,Custom field (Epic Link)', ...rows].join('\n'),
  );
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

describe('findMissingMapping — khoá prototype', () => {
  it('tên Jira "constructor"/"__proto__" không được coi là đã ghép', () => {
    const analysis = {
      issueTypes: ['constructor'],
      statuses: ['__proto__'],
      priorities: ['toString'],
    };
    const miss = findMissingMapping(analysis, {
      issueTypes: {},
      statuses: {},
      priorities: {},
      users: {},
    });
    expect(miss).toEqual({
      issueTypes: ['constructor'],
      statuses: ['__proto__'],
      priorities: ['toString'],
    });
  });
});

describe('summarizeUnmatchedAssignees / formatUnmatchedAssignees', () => {
  it('không có ai không khớp → null', () => {
    expect(summarizeUnmatchedAssignees(new Map())).toBeNull();
  });
  it('gộp tổng số việc, sắp nhiều việc nhất trước, rồi theo tên', () => {
    const u = summarizeUnmatchedAssignees(
      new Map([
        ['b@x.com', 1],
        ['An', 3],
        ['Bình', 1],
      ]),
    )!;
    expect(u.skipped).toBe(5);
    expect(u.listed.map((x) => x.name)).toEqual(['An', 'b@x.com', 'Bình']);
    expect(u.more).toBe(0);
  });
  it(`liệt kê tối đa ${MAX_UNMATCHED_LISTED} tên, phần còn lại gộp "và N người khác"; tổng số việc vẫn đủ`, () => {
    const counts = new Map(Array.from({ length: 25 }, (_, i) => [`u${i}`, 1] as const));
    const u = summarizeUnmatchedAssignees(counts)!;
    expect(u.listed).toHaveLength(MAX_UNMATCHED_LISTED);
    expect(u.more).toBe(5);
    expect(u.skipped).toBe(25);
    const msg = formatUnmatchedAssignees(u);
    expect(msg).toContain('25 việc');
    expect(msg).toContain('và 5 người khác');
    expect(msg).not.toContain('u9 (');
  });
  it('câu cảnh báo nêu tên/email và số việc', () => {
    const u = summarizeUnmatchedAssignees(new Map([['cuong@x.com', 2]]))!;
    expect(formatUnmatchedAssignees(u)).toContain('cuong@x.com (2 việc)');
  });
});
