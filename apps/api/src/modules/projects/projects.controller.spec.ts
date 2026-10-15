import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { ProjectsController } from './projects.controller';

function make(perms: string[]) {
  const rbac = { getEffectivePermissions: vi.fn(() => Promise.resolve(new Set(perms))) };
  return { ctrl: new ProjectsController({} as never, rbac as never), rbac };
}

describe('ProjectsController.myPermissions', () => {
  it('trả quyền hiệu lực của user ở đúng dự án, đã sắp xếp', async () => {
    const { ctrl, rbac } = make(['worklog:create', 'issue:edit', 'project:view']);
    const res = await ctrl.myPermissions('w1', { id: 'u1' } as never, 'p1');
    expect(rbac.getEffectivePermissions).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(res).toEqual({
      projectId: 'p1',
      permissions: ['issue:edit', 'project:view', 'worklog:create'],
    });
  });

  it('khai báo policy: project:view + ProjectRef param id', () => {
    const h = ProjectsController.prototype.myPermissions;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h)).toEqual([PERMISSIONS.PROJECT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, h)).toEqual({ kind: 'param', param: 'id' });
  });
});
