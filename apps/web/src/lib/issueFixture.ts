import type { IssueDto } from '@tirapro/types';

export const TYPES = {
  epic: {
    id: 'te',
    name: 'Epic',
    key: 'EPIC',
    iconUrl: null,
    color: null,
    hierarchyLevel: 1,
    isSubtask: false,
  },
  story: {
    id: 'ts',
    name: 'Story',
    key: 'STORY',
    iconUrl: null,
    color: null,
    hierarchyLevel: 0,
    isSubtask: false,
  },
  sub: {
    id: 'tu',
    name: 'Sub-task',
    key: 'SUBTASK',
    iconUrl: null,
    color: null,
    hierarchyLevel: -1,
    isSubtask: true,
  },
} as const;
const status = (category: 'TODO' | 'DONE') =>
  ({
    id: category,
    workflowId: 'w',
    name: category,
    category,
    color: null,
    order: 0,
    isInitial: false,
  }) as IssueDto['status'];

/** `mk('id', { t: 'epic', done: true, parentId: 'x', storyPoints: 3 })` */
export const mk = (
  id: string,
  o: Partial<IssueDto> & { t?: keyof typeof TYPES; done?: boolean } = {},
): IssueDto => {
  const { t, done, ...rest } = o;
  return {
    id,
    key: id.toUpperCase(),
    summary: id,
    type: TYPES[t ?? 'story'],
    status: status(done ? 'DONE' : 'TODO'),
    priority: null,
    parentId: null,
    epicId: null,
    storyPoints: null,
    projectId: 'p',
    ...rest,
  } as unknown as IssueDto;
};
