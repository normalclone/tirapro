import { describe, expect, it } from 'vitest';
import type { IssueTreeNode } from '@/lib/issueTree';
import { flattenVisible, visibleKeys } from './treeOrder';

const n = (key: string, children: IssueTreeNode[] = []): IssueTreeNode =>
  ({ issue: { id: `id-${key}`, key }, children, depth: 0 }) as unknown as IssueTreeNode;
const tree = [n('E-1', [n('T-1', [n('S-1'), n('S-2')]), n('T-2')]), n('E-2', [n('T-3')]), n('B-1')];

describe('flattenVisible — thứ tự hàng nhìn thấy (duyệt sâu trước, bỏ con của nhánh thu gọn)', () => {
  it('mở hết: E-1, T-1, S-1, S-2, T-2, E-2, T-3, B-1', () => {
    expect(visibleKeys(flattenVisible(tree, new Set()))).toEqual([
      'E-1',
      'T-1',
      'S-1',
      'S-2',
      'T-2',
      'E-2',
      'T-3',
      'B-1',
    ]);
  });
  it('thu gọn T-1: bỏ S-1, S-2 (nút nhánh vẫn có mặt)', () => {
    expect(visibleKeys(flattenVisible(tree, new Set(['id-T-1'])))).toEqual([
      'E-1',
      'T-1',
      'T-2',
      'E-2',
      'T-3',
      'B-1',
    ]);
  });
  it('thu gọn E-1: bỏ cả nhánh, ‹ › nhảy từ E-1 sang E-2', () => {
    const keys = visibleKeys(flattenVisible(tree, new Set(['id-E-1'])));
    expect(keys).toEqual(['E-1', 'E-2', 'T-3', 'B-1']);
  });
});
