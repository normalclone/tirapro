import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types/request';
import { MeController } from './me.controller';

describe('MeController GET /me/overview', () => {
  it('cần project:view; gọi service theo organizationId (JWT) và user.id từ token', async () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MeController.prototype.getOverview)).toEqual([
      PERMISSIONS.PROJECT_VIEW,
    ]);
    const overview = vi.fn().mockResolvedValue({ counts: {} });
    const ctrl = new MeController({ overview } as never);
    await ctrl.getOverview('W1', { id: 'U1' } as AuthUser);
    expect(overview).toHaveBeenCalledWith('W1', 'U1');
  });
});
