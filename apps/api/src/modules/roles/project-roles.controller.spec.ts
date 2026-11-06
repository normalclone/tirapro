import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { createProjectRoleSchema } from './roles.schemas';
import { ProjectRolesController } from './project-roles.controller';
import { RolesController } from './roles.controller';

const proto = ProjectRolesController.prototype as unknown as Record<string, object>;
const rolesProto = RolesController.prototype as unknown as Record<string, object>;

describe('ProjectRolesController — quyền', () => {
  it.each(['create', 'update', 'remove'])(
    '%s: project:admin của CHÍNH dự án (@ProjectRef param projectId)',
    (name) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, proto[name]!)).toEqual([
        PERMISSIONS.PROJECT_ADMIN,
      ]);
      expect(Reflect.getMetadata(PROJECT_REF_KEY, proto[name]!)).toEqual({
        kind: 'param',
        param: 'projectId',
      });
    },
  );

  it('xem danh sách: chỉ cần xem được dự án (để chọn vai trò khi thêm người)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.list!)).toEqual([PERMISSIONS.PROJECT_VIEW]);
    expect(Reflect.getMetadata(PROJECT_REF_KEY, proto.list!)).toEqual({
      kind: 'param',
      param: 'projectId',
    });
  });
});

describe('RolesController (mẫu vai trò dùng chung) — chỉ Quản trị', () => {
  it.each(['create', 'update', 'remove'])(
    '%s cần organization:admin (không còn member:manage)',
    (name) => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, rolesProto[name]!)).toEqual([
        PERMISSIONS.ORGANIZATION_ADMIN,
      ]);
    },
  );
  it('xem danh mục: mọi thành viên tổ chức', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, rolesProto.list!)).toEqual([
      PERMISSIONS.ORGANIZATION_VIEW,
    ]);
  });
});

describe('createProjectRoleSchema', () => {
  it('cần tên hoặc mẫu', () => {
    expect(createProjectRoleSchema.safeParse({}).success).toBe(false);
    expect(createProjectRoleSchema.safeParse({ name: 'A' }).success).toBe(true);
    expect(createProjectRoleSchema.safeParse({ fromTemplateId: 't' }).success).toBe(true);
  });
});
