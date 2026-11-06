import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { AUTH_ONLY_KEY } from '../../common/decorators/auth-only.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PROJECT_REF_KEY } from '../../common/decorators/project-ref.decorator';
import { ProjectTelegramController } from './project-telegram.controller';
import { TelegramPersonalController } from './telegram-personal.controller';

const proto = ProjectTelegramController.prototype as unknown as Record<string, object>;

describe('ProjectTelegramController — quyền', () => {
  it.each(['overview', 'createCode', 'poll', 'updateChannel', 'removeChannel'])(
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

  it('danh sách dự án quản trị chỉ cần đăng nhập (dữ liệu của chính người gọi, đã lọc theo quyền từng dự án)', () => {
    expect(Reflect.getMetadata(AUTH_ONLY_KEY, proto.managedProjects!)).toBe(true);
  });

  it('không có route tạo/sửa bot hay kênh cấp tổ chức trong controller dự án', () => {
    const routes = Object.getOwnPropertyNames(ProjectTelegramController.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(routes.sort()).toEqual(
      [
        'createCode',
        'managedProjects',
        'overview',
        'poll',
        'removeChannel',
        'updateChannel',
      ].sort(),
    );
  });
});

describe('TelegramPersonalController', () => {
  it('mọi route AuthOnly (chỉ đụng dữ liệu của chính người gọi)', () => {
    expect(Reflect.getMetadata(AUTH_ONLY_KEY, TelegramPersonalController)).toBe(true);
  });
});
