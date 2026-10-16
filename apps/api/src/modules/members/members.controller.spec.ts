import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { WorkspaceMembersController } from './members.controller';

describe('WorkspaceMembersController.createAccount — phản hồi mang mật khẩu tạm', () => {
  it('đặt Cache-Control: no-store (như admin.controller)', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      WorkspaceMembersController.prototype.createAccount,
    ) as Array<{ name: string; value: string }>;
    expect(headers).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });
});
