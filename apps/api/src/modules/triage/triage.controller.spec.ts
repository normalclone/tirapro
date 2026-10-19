import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { TriageController } from './triage.controller';

const perms = (name: keyof TriageController) =>
  Reflect.getMetadata(PERMISSIONS_KEY, TriageController.prototype[name]) as string[];

describe('TriageController — quyền duyệt (S-I4)', () => {
  it.each(['accept', 'decline', 'snooze'] as const)(
    '%s đòi issue:triage (không phải issue:edit + own-only)',
    (name) => {
      expect(perms(name)).toEqual([PERMISSIONS.ISSUE_TRIAGE]);
    },
  );

  it.each(['inbox', 'count'] as const)(
    'xem hộp/đếm (%s) đòi issue:triage — project:view một mình không đủ (403, không lộ việc chờ duyệt của người khác)',
    (name) => {
      expect(perms(name)).toEqual([PERMISSIONS.ISSUE_TRIAGE]);
      expect(perms(name)).not.toContain(PERMISSIONS.PROJECT_VIEW);
    },
  );

  it('accept chuyển thẳng cho service, không còn nhánh own-only', async () => {
    const triage = { accept: vi.fn(() => Promise.resolve({})) };
    await new TriageController(triage as never).accept('w1', { id: 'u1' } as never, 'i1', {
      version: 1,
    });
    expect(triage.accept).toHaveBeenCalledWith('w1', 'u1', 'i1', { version: 1 });
  });
});
