import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { IssuesController } from './issues.controller';

describe('IssuesController.rank', () => {
  it('policy: backlog:manage + issue:edit, ProjectRef issue/id', () => {
    const h = IssuesController.prototype.rank;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([
      PERMISSIONS.BACKLOG_MANAGE,
      PERMISSIONS.ISSUE_EDIT,
    ]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'issue', param: 'id' });
  });

  it('chuyển tiếp tới move() với ownOnly, không bao giờ mang statusId/boardId/force', async () => {
    const issues = { move: vi.fn(() => Promise.resolve({})) };
    const ctrl = new IssuesController(issues as never);
    await ctrl.rank(
      'w1',
      { id: 'u1' } as never,
      'i1',
      { version: 3, afterId: 'a', beforeId: null, sprintId: 'sp1' },
      true,
    );
    expect(issues.move).toHaveBeenCalledWith(
      'w1',
      'u1',
      'i1',
      { version: 3, afterId: 'a', beforeId: null, sprintId: 'sp1' },
      true,
    );
  });
});
