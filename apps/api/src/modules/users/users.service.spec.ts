import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

describe('UsersService — escape ký tự đại diện LIKE khi tìm người dùng', () => {
  const expected = [
    { displayName: { contains: '\\_', mode: 'insensitive' } },
    { email: { contains: '\\_', mode: 'insensitive' } },
  ];

  it('listWorkspaceMembers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ workspaceMembership: { findMany } } as never, {} as never);
    await service.listWorkspaceMembers('w1', '_');
    const call = findMany.mock.calls[0] as unknown as [{ where: { user: { OR: unknown[] } } }];
    expect(call[0].where.user.OR).toEqual(expected);
  });

  it('listAllUsers: search="_" không khớp mọi người', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const service = new UsersService({ user: { findMany } } as never, {} as never);
    await service.listAllUsers('_');
    const call = findMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }];
    expect(call[0].where.OR).toEqual(expected);
  });
});
