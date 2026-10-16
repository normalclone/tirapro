import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { DigestsController } from './digests.controller';

const perms = (name: keyof DigestsController) =>
  Reflect.getMetadata(PERMISSIONS_KEY, DigestsController.prototype[name]) as string[];

describe('DigestsController — quyền (WO-M3)', () => {
  it('preview dùng CÙNG quyền với create/update/run (integration:manage), không phải digest:manage', () => {
    expect(perms('preview')).toEqual([PERMISSIONS.INTEGRATION_MANAGE]);
    for (const m of ['create', 'update', 'run'] as const)
      expect(perms(m), m).toEqual(perms('preview'));
  });
});
