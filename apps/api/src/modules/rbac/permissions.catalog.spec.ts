import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
} from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { WikiController } from '../wiki/wiki.controller';

describe('wiki:manage — quyền cấp dự án (A8)', () => {
  it('scope PROJECT trong catalog', () => {
    expect(PERMISSION_CATALOG.find((k) => k.key === 'wiki:manage')?.scope).toBe('PROJECT');
  });

  it.each([
    SYSTEM_ROLES.PROJECT_ADMIN,
    SYSTEM_ROLES.BUSINESS_ANALYST,
    SYSTEM_ROLES.PRODUCT_OWNER,
    SYSTEM_ROLES.SCRUM_MASTER,
    SYSTEM_ROLES.DEVELOPER,
    SYSTEM_ROLES.TESTER,
  ])('%s viết được wiki', (role) => {
    expect(SYSTEM_ROLE_PERMISSIONS[role]).toContain(PERMISSIONS.WIKI_MANAGE);
  });

  it.each([
    SYSTEM_ROLES.DESIGNER,
    SYSTEM_ROLES.DEVOPS,
    SYSTEM_ROLES.REVIEWER,
    SYSTEM_ROLES.STAKEHOLDER,
    SYSTEM_ROLES.PROJECT_DEVELOPER,
    SYSTEM_ROLES.PROJECT_REPORTER,
  ])('%s chỉ đọc wiki', (role) => {
    expect(SYSTEM_ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.WIKI_MANAGE);
  });

  it('Workspace Admin vẫn có wiki:manage (mọi quyền trong catalog)', () => {
    expect(SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.WORKSPACE_ADMIN]).toContain(
      PERMISSIONS.WIKI_MANAGE,
    );
  });

  const proto = WikiController.prototype as unknown as Record<string, object>;
  const meta = (key: string, method: string) => Reflect.getMetadata(key, proto[method]!) as unknown;

  it('DELETE /wiki/:id đòi project:admin, theo dự án của trang', () => {
    expect(meta(PERMISSIONS_KEY, 'remove')).toEqual([PERMISSIONS.PROJECT_ADMIN]);
    expect(meta(PROJECT_REF_KEY, 'remove')).toEqual({ kind: 'wikiPage', param: 'id' });
  });

  it('POST/PUT/move đòi wiki:manage và khai báo dự án để guard tính quyền theo dự án', () => {
    for (const m of ['create', 'update', 'move']) {
      expect(meta(PERMISSIONS_KEY, m)).toEqual([PERMISSIONS.WIKI_MANAGE]);
    }
    expect(meta(PROJECT_REF_KEY, 'create')).toEqual({ kind: 'body', param: 'projectId' });
    expect(meta(PROJECT_REF_KEY, 'update')).toEqual({ kind: 'wikiPage', param: 'id' });
    expect(meta(PROJECT_REF_KEY, 'move')).toEqual({ kind: 'wikiPage', param: 'id' });
  });
});
