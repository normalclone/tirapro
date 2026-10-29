import type { IssueDto, SprintDto } from '@tirapro/types';
import type { DraftMeta } from './draft';
import type { AssistantDeps, AssistantProject, RespondEnv } from './respond';

/** Dữ liệu giả cho test của Trợ lý (không có logic). */
const NOW = new Date('2026-10-29T03:00:00Z');

export const PROJ: AssistantProject = { id: 'p1', key: 'DEMO', name: 'Demo' };
const PROJ2: AssistantProject = { id: 'p2', key: 'ALPHA', name: 'Alpha' };

export const META: DraftMeta = {
  issueTypes: [
    { id: 't-task', name: 'Task', key: 'TASK', isSubtask: false },
    { id: 't-bug', name: 'Bug', key: 'BUG', isSubtask: false },
    { id: 't-story', name: 'Story', key: 'STORY', isSubtask: false },
    { id: 't-epic', name: 'Epic', key: 'EPIC', isSubtask: false, hierarchyLevel: 1 },
    { id: 't-sub', name: 'Sub-task', key: 'SUBTASK', isSubtask: true },
  ],
  priorities: [
    { id: 'pr-high', name: 'High', rank: 2 },
    { id: 'pr-med', name: 'Medium', rank: 3, isDefault: true },
    { id: 'pr-low', name: 'Low', rank: 4 },
  ],
};

export const USERS = [
  { id: 'u-an', displayName: 'An Nguyễn' },
  { id: 'u-binh', displayName: 'Bình Trần' },
];

export const SPRINTS: SprintDto[] = [
  {
    id: 's1',
    projectId: 'p1',
    boardId: null,
    name: 'Sprint 7',
    goal: 'Ra mắt bản beta',
    state: 'ACTIVE',
    startDate: '2026-10-20T00:00:00Z',
    endDate: '2026-11-02T00:00:00Z',
    completeDate: null,
    sequence: 7,
  },
  {
    id: 's2',
    projectId: 'p1',
    boardId: null,
    name: 'Sprint 8',
    goal: null,
    state: 'FUTURE',
    startDate: null,
    endDate: null,
    completeDate: null,
    sequence: 8,
  },
] as SprintDto[];

export function issue(over: Partial<Record<string, unknown>> = {}): IssueDto {
  return {
    id: 'i1',
    key: 'DEMO-TASK-1',
    summary: 'Sửa lỗi đăng nhập',
    projectId: 'p1',
    parentId: null,
    type: { id: 't-task', name: 'Task', key: 'TASK' },
    status: { id: 'st1', name: 'In Progress', category: 'IN_PROGRESS' },
    priority: { id: 'pr-high', name: 'High' },
    assignee: { id: 'u-an', displayName: 'An Nguyễn' },
    dueDate: '2026-10-25T10:00:00Z',
    ...over,
  } as unknown as IssueDto;
}

export const ENV: RespondEnv = {
  pathname: '/p/DEMO/board',
  now: NOW,
  project: PROJ,
  projects: [PROJ, PROJ2],
  recentKeys: ['ALPHA'],
  tour: { available: false },
  issueKey: null,
};

/** Deps giả: mọi lời gọi đều ghi lại; `createIssue` không có trong `AssistantDeps` (chỉ `confirmDraft` nhận hàm tạo). */
export function makeDeps(over: Partial<AssistantDeps> = {}): AssistantDeps & { calls: string[] } {
  const calls: string[] = [];
  const rec =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A): R => {
      calls.push(name);
      return fn(...a);
    };
  return {
    calls,
    searchJql: rec('searchJql', () => Promise.resolve({ items: [], hasMore: false })),
    getIssue: rec('getIssue', () => Promise.resolve(issue())),
    getCommentCount: rec('getCommentCount', () => Promise.resolve(3)),
    getProjectIssues: rec('getProjectIssues', () =>
      Promise.resolve([issue(), issue({ id: 'i2', key: 'DEMO-SUB-1', parentId: 'i1' })]),
    ),
    getSprints: rec('getSprints', () => Promise.resolve(SPRINTS)),
    getMeta: rec('getMeta', () => Promise.resolve(META)),
    getUsers: rec('getUsers', () => Promise.resolve(USERS)),
    canCreate: rec('canCreate', () => Promise.resolve(true)),
    ...over,
  };
}

/** Hàm giả trả ngay một giá trị (async không cần `await`). */
export const ok =
  <T>(v: T) =>
  (): Promise<T> =>
    Promise.resolve(v);
