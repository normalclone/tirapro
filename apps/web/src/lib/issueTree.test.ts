import { describe, expect, it } from 'vitest';
import {
  buildIssueTree,
  descendantIdsWithSelf,
  subtreeProgress,
  type IssueTreeNode,
} from './issueTree';
import { mk } from './issueFixture';

const ids = (nodes: IssueTreeNode[]): string[] =>
  nodes.flatMap((n) => [n.issue.id, ...ids(n.children)]);

describe('cây theo parentId ?? epicId', () => {
  const list = [
    mk('e', { t: 'epic' }),
    mk('s', { epicId: 'e', done: true }),
    mk('c', { parentId: 's' }),
    mk('lone'),
  ];
  it('việc gắn epicId hiện dưới epic; con trực tiếp dưới cha', () => {
    const tree = buildIssueTree(list);
    const e = tree.find((n) => n.issue.id === 'e')!;
    expect(e.children.map((n) => n.issue.id)).toEqual(['s']);
    expect(e.children[0]!.children.map((n) => n.issue.id)).toEqual(['c']);
    expect(tree.map((n) => n.issue.id).sort()).toEqual(['e', 'lone']);
  });
  it('tiến độ epic tính cả việc gắn epicId', () => {
    expect(subtreeProgress(list, 'e')).toMatchObject({ total: 2, done: 1 });
  });
  it('descendantIdsWithSelf đi theo cả epicId', () => {
    expect([...descendantIdsWithSelf(list, 'e')].sort()).toEqual(['c', 'e', 's']);
  });
  it('vòng lẫn (X.parentId=Y, Y.epicId=X) không làm mất việc', () => {
    const x = mk('x', { t: 'epic', parentId: 'y' });
    const y = mk('y', { epicId: 'x' });
    expect(ids(buildIssueTree([x, y])).sort()).toEqual(['x', 'y']);
  });
});
