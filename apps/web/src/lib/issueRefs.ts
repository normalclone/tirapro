import type { IssueDto } from '@tirapro/types';

export const isEpicIssue = (i: Pick<IssueDto, 'type'>): boolean =>
  i.type.key === 'EPIC' || i.type.hierarchyLevel >= 1;
export const treeParentId = (i: Pick<IssueDto, 'parentId' | 'epicId'>): string | null =>
  i.parentId ?? i.epicId ?? null;
